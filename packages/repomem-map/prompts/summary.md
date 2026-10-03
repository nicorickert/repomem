# File summary prompt

You are generating a structural summary for a single source file so that other
developers and AI tools can quickly understand **what the file is about** and
**find it later**.

Given the file's path and its full content, produce:

1. **summary** — 1–3 sentences, plain language. Describe the file's purpose and
   its main responsibility. Focus on *what it is and does*, not a line-by-line
   walkthrough. Do not invent behaviour you cannot see in the file.

2. **search_terms** — a short list (3–8) of lowercase keywords someone might
   search for to find this file: domain concepts, key exported names, and the
   kind of thing it is (e.g. "parser", "http client", "zod schema"). Avoid
   generic filler words.

Guidelines:

- Be concise. These summaries are read into an index and an agent's context
  window; shorter is better.
- Prefer concrete nouns over vague descriptions.
- If the file is configuration, tests, or data, say so plainly.
- Never include secrets, tokens, or copied large code blocks in the summary.
