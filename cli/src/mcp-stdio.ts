import { createInterface } from "node:readline";
import { handleMessage } from "@/lib/mcp/server";

/**
 * `rankforge mcp` — the RankForge agent as a LOCAL MCP server over stdio.
 *
 *   claude mcp add rankforge -- npx -y rankforge-cli mcp
 *
 * Newline-delimited JSON-RPC on stdin/stdout (MCP stdio transport). It runs on
 * the developer's machine, so it can audit http://localhost — no hosted
 * instance, no token, no account. stdout carries protocol messages ONLY; all
 * logging goes to stderr.
 */
export async function runStdioServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  process.stderr.write("rankforge MCP server ready (stdio)\n");

  // Requests are handled concurrently (an audit can take seconds) but each
  // response is written as a single atomic line.
  const pending = new Set<Promise<void>>();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const job = (async () => {
      const messages = Array.isArray(msg) ? msg : [msg];
      const replies = [];
      for (const m of messages) {
        const r = await handleMessage(m);
        if (r !== null) replies.push(r);
      }
      if (replies.length) send(Array.isArray(msg) ? replies : replies[0]);
    })().catch((e) => {
      process.stderr.write(`rankforge mcp error: ${e instanceof Error ? e.message : String(e)}\n`);
    });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
}
