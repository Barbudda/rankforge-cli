import { MCP_TOOLS } from "./tools";

/**
 * Transport-agnostic MCP (JSON-RPC 2.0) dispatcher — shared by the hosted
 * Streamable-HTTP route (src/app/api/mcp/route.ts) and the CLI's local stdio
 * server (`rankforge mcp`). One implementation, so both surfaces expose the
 * exact same tools and protocol behaviour.
 */

export const SERVER_VERSION = "0.2.0";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}


export async function handleMessage(raw: unknown): Promise<unknown | null> {
  // Shape guard: a non-object (null, array, string, number) is an Invalid
  // Request, not a crash. `null`/`[]` bodies used to throw a 500.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const msg = raw as JsonRpcRequest;
  const { id, method, params } = msg;

  // A JSON-RPC *response* posted by a client (has result/error, no method) is
  // accepted silently (no reply).
  if (typeof method !== "string") {
    if ("result" in msg || "error" in msg) return null;
    // A request with an explicit null id is malformed per the MCP base spec.
    if (id === undefined) return null; // notification without method — ignore
    return rpcError(id ?? null, -32600, "Invalid Request");
  }

  // Notifications have no id → no response body. (null id is malformed for a
  // request, but we tolerate it as fire-and-forget rather than erroring.)
  if (id === undefined || id === null) {
    // Still no side-effect-free reply for notifications.
    if (method.startsWith("notifications/")) return null;
    return null;
  }

  switch (method) {
    case "initialize": {
      const requested = String(params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "rankforge",
          title: "RankForge — technical SEO agent",
          version: SERVER_VERSION,
        },
        instructions:
          "RankForge measures technical SEO deterministically. Typical loop: audit_site on the dev/prod URL → fix the reported issues in this repository (get_fix_template gives idiomatic patches for mechanical ones) → re-run audit_site to verify. Use seo_docs to explain any issue to the user. Never promise search-ranking outcomes.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = String(params?.name ?? "");
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await tool.handler(args);
        return rpcResult(id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        // Tool-level failures are results with isError (per spec), not
        // protocol errors — the calling agent can read and react to them.
        return rpcResult(id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : "Tool failed." }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
