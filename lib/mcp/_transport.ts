import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface RawToolResult {
  content?: Array<{ type: string; text?: string }>;
  [k: string]: unknown;
}

/**
 * One-shot MCP tool call. Opens a transport, calls the tool, closes.
 * Isolated here so callMcpTool() can be unit-tested by mocking this module.
 */
export async function invokeTool(opts: {
  url: string;
  accessToken: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<RawToolResult> {
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  });
  const client = new Client(
    { name: "cumbuca-dashboard", version: "0.2.0" },
    { capabilities: {} }
  );
  try {
    await client.connect(transport);
    const raw = (await client.callTool({
      name: opts.tool,
      arguments: opts.args,
    })) as RawToolResult;
    return raw;
  } finally {
    try {
      await client.close();
    } catch {
      /* swallow */
    }
  }
}
