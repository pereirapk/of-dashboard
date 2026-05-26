import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { decrypt, encrypt } from "@/lib/crypto";

export class AccessTokenError extends Error {
  constructor(
    message: string,
    public reason: "missing" | "refresh_failed"
  ) {
    super(message);
    this.name = "AccessTokenError";
  }
}

const SAFETY_MARGIN_SECONDS = 30;

async function refreshTokenAtKeycloak(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const issuer = process.env.KEYCLOAK_ISSUER;
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    throw new AccessTokenError("Keycloak env vars missing", "missing");
  }
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new AccessTokenError(
      `Refresh failed: ${response.status} ${JSON.stringify(data)}`,
      "refresh_failed"
    );
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number),
  };
}

/**
 * Returns a usable access token for the given bank_connection. Refreshes via
 * Keycloak if expired (or about to). Updates the connection row with new
 * encrypted tokens.
 *
 * Throws AccessTokenError on any failure (connection not found, no refresh
 * token, refresh call failed).
 */
export async function ensureFreshAccessToken(
  db: Db,
  bankConnectionId: ObjectId
): Promise<string> {
  const conn = await db
    .collection("bank_connections")
    .findOne({ _id: bankConnectionId });
  if (!conn) {
    throw new AccessTokenError("Connection not found", "missing");
  }

  const tokenExpiresAt = conn.tokenExpiresAt as Date | undefined;
  const tokenExpiresAtUnix = tokenExpiresAt
    ? Math.floor(tokenExpiresAt.getTime() / 1000)
    : 0;
  const now = Math.floor(Date.now() / 1000);

  if (tokenExpiresAtUnix - SAFETY_MARGIN_SECONDS > now) {
    return decrypt(conn.encryptedAccessToken as string, "OPENFINANCE_TOKEN_KEY");
  }

  if (!conn.encryptedRefreshToken) {
    throw new AccessTokenError(
      "Access token expired and no refresh token available",
      "missing"
    );
  }
  const refreshPlain = decrypt(
    conn.encryptedRefreshToken as string,
    "OPENFINANCE_TOKEN_KEY"
  );
  const refreshed = await refreshTokenAtKeycloak(refreshPlain);
  await db.collection("bank_connections").updateOne(
    { _id: bankConnectionId },
    {
      $set: {
        encryptedAccessToken: encrypt(
          refreshed.accessToken,
          "OPENFINANCE_TOKEN_KEY"
        ),
        encryptedRefreshToken: encrypt(
          refreshed.refreshToken,
          "OPENFINANCE_TOKEN_KEY"
        ),
        tokenExpiresAt: new Date(refreshed.expiresAt * 1000),
        updatedAt: new Date(),
      },
    }
  );
  return refreshed.accessToken;
}
