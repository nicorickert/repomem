import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LiveGraph } from "../../src/deps/live.js";
import { DepGraph } from "../../src/deps/graph.js";
import { scan } from "../../src/scan.js";

let root: string;
let fileClock = 0;

async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
  fileClock += 10;
  const t = new Date(Date.UTC(2030, 0, 1) + fileClock * 1000);
  await fs.utimes(dest, t, t);
}

/** A hand-driven clock and a scan that counts how often it runs. */
function harness(ttlMs = 1000) {
  const state = { now: 0, scans: 0, failNext: false };
  const live = new LiveGraph(root, {
    ttlMs,
    now: () => state.now,
    scanFiles: async (r) => {
      state.scans += 1;
      if (state.failNext) {
        state.failNext = false;
        throw new Error("scan exploded");
      }
      return scan(r);
    },
  });
  return { live, state };
}

beforeEach(async () => {
  fileClock = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-live-"));
  await wf("src/a.ts", `import "./b";\n`);
  await wf("src/b.ts", `export const b = 1;\n`);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("LiveGraph", () => {
  it("builds the graph on first use", async () => {
    const { live } = harness();
    const g = await live.current();
    expect(g.dependents("src/b.ts")).toEqual(["src/a.ts"]);
    expect(live.stats().refreshes).toBe(1);
    expect(live.stats().lastReport?.reparsed).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("does not even scan again inside the TTL window", async () => {
    const { live, state } = harness(1000);
    await live.current();
    state.now = 999;
    await live.current();
    await live.current();
    expect(state.scans).toBe(1);
    expect(live.stats().refreshes).toBe(1);
  });

  it("inside the TTL a change is not visible yet (cheap path); after it, it is", async () => {
    const { live, state } = harness(1000);
    const g = await live.current();
    await wf("src/c.ts", `import "./a";\n`);
    state.now = 500;
    expect((await live.current()).has("src/c.ts")).toBe(false);
    state.now = 1000;
    const after = await live.current();
    expect(after.has("src/c.ts")).toBe(true);
    expect(after.dependents("src/a.ts")).toEqual(["src/c.ts"]);
    expect(after).toBe(g); // same object, updated in place
  });

  it("after the TTL with no changes it rescans but parses nothing", async () => {
    const { live, state } = harness(1000);
    await live.current();
    state.now = 5000;
    await live.current();
    expect(state.scans).toBe(2);
    expect(live.stats().refreshes).toBe(2);
    expect(live.stats().lastReport).toEqual({ reparsed: [], removed: [], relinked: false });
  });

  it("an edit costs exactly one parse and updates the blast radius", async () => {
    const { live, state } = harness(1000);
    await live.current();
    await wf("src/a.ts", `import "./b";\nimport "./d";\n`);
    await wf("src/d.ts", `export const d = 1;\n`);
    state.now = 2000;
    const g = await live.current();
    expect(live.stats().lastReport?.reparsed).toEqual(["src/a.ts", "src/d.ts"]);

    await wf("src/b.ts", `export const b = 2;\n`);
    state.now = 4000;
    await live.current();
    expect(live.stats().lastReport?.reparsed).toEqual(["src/b.ts"]);
    expect(g.dependencies("src/a.ts")).toEqual(["src/b.ts", "src/d.ts"]);
  });

  it("matches a from-scratch build after a mix of changes", async () => {
    const { live, state } = harness(1000);
    await live.current();
    await wf("src/c.ts", `import "./b";\n`);
    await fs.rm(path.join(root, "src/a.ts"));
    state.now = 2000;
    const inc = await live.current();
    const fresh = await DepGraph.build(root);
    const snap = (g: DepGraph) =>
      g.nodes().sort().map((n) => [n, g.dependencies(n), g.dependents(n)]);
    expect(snap(inc)).toEqual(snap(fresh));
  });

  it("concurrent callers after the TTL share a single refresh (single-flight)", async () => {
    const { live, state } = harness(1000);
    await live.current();
    await wf("src/c.ts", `import "./a";\n`);
    state.now = 3000;
    const results = await Promise.all([live.current(), live.current(), live.current(), live.current()]);
    expect(state.scans).toBe(2); // initial + ONE shared refresh
    expect(live.stats().refreshes).toBe(2);
    for (const g of results) expect(g).toBe(results[0]);
    expect(results[0]!.has("src/c.ts")).toBe(true);
  });

  it("concurrent first calls share the initial build too", async () => {
    const { live, state } = harness();
    const [a, b] = await Promise.all([live.current(), live.current()]);
    expect(a).toBe(b);
    expect(state.scans).toBe(1);
  });

  it("a failed first build rejects and the next call retries", async () => {
    const { live, state } = harness();
    state.failNext = true;
    await expect(live.current()).rejects.toThrow("scan exploded");
    const g = await live.current();
    expect(g.has("src/a.ts")).toBe(true);
  });

  it("a failed refresh rejects but keeps serving the last good graph on retry", async () => {
    const { live, state } = harness(1000);
    const g = await live.current();
    state.now = 2000;
    state.failNext = true;
    await expect(live.current()).rejects.toThrow("scan exploded");
    const again = await live.current();
    expect(again).toBe(g);
    expect(again.has("src/a.ts")).toBe(true);
  });
});
