/**
 * One-time Dynamic Client Registration against Cumbuca Keycloak.
 * Run: bun run keycloak:register
 *
 * Prints client_id and client_secret. Paste them into .env.local manually.
 */
const ISSUER = process.env.KEYCLOAK_ISSUER ?? "https://idc.cumbuca.com/realms/cumbuca-mcp";
const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

async function main() {
  const registrationUrl = `${ISSUER}/clients-registrations/openid-connect`;

  const body = {
    client_name: "Cumbuca Dashboard (local dev)",
    redirect_uris: [
      `${APP_BASE}/api/auth/callback/keycloak`,
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile offline_access open-finance",
    token_endpoint_auth_method: "client_secret_basic",
  };

  console.log("→ POST", registrationUrl);
  const res = await fetch(registrationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("DCR failed:", res.status, await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as {
    client_id: string;
    client_secret?: string;
  };

  console.log("\n✓ Registered. Paste these into .env.local:\n");
  console.log(`KEYCLOAK_CLIENT_ID=${data.client_id}`);
  if (data.client_secret) {
    console.log(`KEYCLOAK_CLIENT_SECRET=${data.client_secret}`);
  } else {
    console.log("(No client_secret returned — client is public; will need PKCE-only flow.)");
  }
}

main().catch((err) => {
  console.error("Registration failed:", err);
  process.exit(1);
});
