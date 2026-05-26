import { connectMcp, safeClose } from "./lib/mcp-client.js";
import { capture } from "./lib/capture.js";
import { FileOAuthProvider } from "./lib/file-oauth-provider.js";

const REDIRECT_URI = "http://localhost:7373/callback";

async function main() {
  const provider = new FileOAuthProvider(REDIRECT_URI);

  console.log("Connecting to MCP…");
  const client = await connectMcp({ authProvider: provider });

  try {
    console.log("Listing tools…");
    const tools = await client.listTools();
    await capture("listTools", tools);

    console.log(`\nFound ${tools.tools.length} tool(s):\n`);
    for (const t of tools.tools) {
      console.log(`• ${t.name}`);
      console.log(`  ${t.description ?? "(no description)"}`);
      console.log(
        `  inputSchema keys: ${Object.keys(t.inputSchema?.properties ?? {}).join(", ") || "(none)"}`
      );
      console.log("");
    }
  } finally {
    await safeClose(client);
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exitCode = 1;
});
