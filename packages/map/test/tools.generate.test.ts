import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerGenerationTools } from "../src/tools.js";
import { hashContent, readSummary } from "../src/summary.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function textOf(result: ToolCall): string {
  const first = result.content[0];
  return first && first.type === "text" ? (first.text ?? "") : "";
}

async function makeClient(root: string): Promise<Client> {
  const server = new McpServer({ name: "repomem-map", version: "0.0.0" });
  registerGenerationTools(server, root);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-gen-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(root, "src", "b.ts"), "export const b = 2;\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("request_summaries", () => {
  it("returns pending files, the prompt, and the cap", async () => {
    const client = await makeClient(root);
    const res = (await client.callTool({
      name: "request_summaries",
      arguments: {},
    })) as ToolCall;
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.cap).toBe(20);
    expect(typeof payload.prompt).toBe("string");
    expect(payload.prompt.length).toBeGreaterThan(0);
    const paths = payload.pending.map((p: { path: string }) => p.path).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(payload.pending[0]).toHaveProperty("hash");
  });

  it("honors the limit argument", async () => {
    const client = await makeClient(root);
    const res = (await client.callTool({
      name: "request_summaries",
      arguments: { limit: 1 },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.pending).toHaveLength(1);
    expect(payload.cap).toBe(1);
  });
});

describe("save_summary", () => {
  it("persists a summary when the hash matches current content", async () => {
    const client = await makeClient(root);
    const hash = hashContent("export const a = 1;\n");
    const res = (await client.callTool({
      name: "save_summary",
      arguments: {
        path: "src/a.ts",
        summary: "Exports constant a.",
        search_terms: ["constant", "a"],
        hash,
      },
    })) as ToolCall;
    expect(res.isError).toBeFalsy();

    const saved = await readSummary(root, "src/a.ts");
    expect(saved).not.toBeNull();
    expect(saved!.summary).toBe("Exports constant a.");
    expect(saved!.model).toBe("agent"); // default
    expect(saved!.hash).toBe(hash);
    expect(saved!.generated_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a hash that does not match current content", async () => {
    const client = await makeClient(root);
    const res = (await client.callTool({
      name: "save_summary",
      arguments: {
        path: "src/a.ts",
        summary: "stale",
        search_terms: ["x"],
        hash: hashContent("something else entirely"),
      },
    })) as ToolCall;
    expect(res.isError).toBe(true);
    expect(textOf(res).toLowerCase()).toContain("hash");
    // nothing was written
    expect(await readSummary(root, "src/a.ts")).toBeNull();
  });

  it("drives the agent loop: pending shrinks as summaries are saved", async () => {
    const client = await makeClient(root);

    let payload = JSON.parse(
      textOf((await client.callTool({ name: "request_summaries", arguments: {} })) as ToolCall),
    );
    expect(payload.pending).toHaveLength(2);

    for (const item of payload.pending) {
      await client.callTool({
        name: "save_summary",
        arguments: {
          path: item.path,
          summary: `summary of ${item.path}`,
          search_terms: ["t"],
          hash: item.hash,
        },
      });
    }

    payload = JSON.parse(
      textOf((await client.callTool({ name: "request_summaries", arguments: {} })) as ToolCall),
    );
    expect(payload.pending).toHaveLength(0);
  });
});
