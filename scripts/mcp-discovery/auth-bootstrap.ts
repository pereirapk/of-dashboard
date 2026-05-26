import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { exec } from "node:child_process";
import { FileOAuthProvider } from "./lib/file-oauth-provider.js";
import { waitForCallback } from "./lib/callback-server.js";

const PORT = 7373;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const MCP_URL = process.env.CUMBUCA_MCP_URL ?? "https://mcp.cumbuca.com/mcp";

async function main() {
  let pendingUrl: URL | undefined;
  const provider = new FileOAuthProvider(REDIRECT_URI, (url) => {
    pendingUrl = url;
  });

  console.log("→ Phase 1: starting OAuth flow against", MCP_URL);
  console.log("  (will trigger DCR if no client registered, then redirect)\n");

  const phase1 = await auth(provider, { serverUrl: MCP_URL });

  if (phase1 === "AUTHORIZED") {
    console.log("✓ Already authorized — token in scripts/mcp-discovery/.auth-state.json");
    return;
  }

  if (!pendingUrl) {
    throw new Error("auth() returned REDIRECT but no authorization URL was captured");
  }

  const state = pendingUrl.searchParams.get("state");
  if (!state) {
    throw new Error("Authorization URL is missing `state` parameter");
  }

  console.log("→ Phase 2: open this URL in your browser to authenticate with Cumbuca:\n");
  console.log("  " + pendingUrl.toString() + "\n");
  console.log("  (attempting to open it automatically)\n");
  exec(`open "${pendingUrl.toString()}"`, () => {
    /* best-effort — works on macOS */
  });

  console.log("→ Waiting for OAuth callback on", REDIRECT_URI, "…\n");
  const { code } = await waitForCallback(PORT, state);
  console.log("✓ Received authorization code\n");

  console.log("→ Phase 3: exchanging code for access token…\n");
  const phase2 = await auth(provider, {
    serverUrl: MCP_URL,
    authorizationCode: code,
  });

  if (phase2 === "AUTHORIZED") {
    console.log("✓ Token persisted to scripts/mcp-discovery/.auth-state.json");
    console.log("  Subsequent probes will use it automatically.");
  } else {
    console.error("✗ Unexpected result from auth():", phase2);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\n✗ Auth bootstrap failed:");
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
