import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

const MCP_URL = process.env.CUMBUCA_MCP_URL ?? "https://mcp.cumbuca.com/mcp";

export interface ConnectOptions {
  headers?: Record<string, string>;
  authProvider?: OAuthClientProvider;
}

export async function connectMcp(opts: ConnectOptions = {}): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: opts.authProvider,
    requestInit: {
      headers: opts.headers ?? {},
    },
  });

  const client = new Client(
    { name: "cumbuca-dashboard-discovery", version: "0.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

export async function safeClose(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // ignore — transport may already be closed
  }
}
