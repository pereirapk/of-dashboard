import NextAuth, { type DefaultSession } from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { getMongo } from "@/lib/mongo";

/**
 * Resolve an env var. At build time (Next.js page-data collection) the env may
 * not be present — we log a warning and return "" so the build succeeds. At
 * request time the missing env will surface as an Auth.js / Keycloak error,
 * which is clearer to the user than a module-load crash.
 */
const envOrWarn = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.warn(`[auth] ${name} env var is missing — auth flow will fail`);
    return "";
  }
  return value;
};

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: number;
    error?: "RefreshAccessTokenError";
    user: DefaultSession["user"] & { id: string };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: number;
    error?: "RefreshAccessTokenError";
  }
}

/**
 * Exchange a refresh_token for a fresh access_token at the Keycloak token
 * endpoint. Throws on any non-2xx response.
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const issuer = envOrWarn("KEYCLOAK_ISSUER");
  const clientId = envOrWarn("KEYCLOAK_CLIENT_ID");
  const clientSecret = envOrWarn("KEYCLOAK_CLIENT_SECRET");
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
    throw new Error(
      `Refresh failed: ${response.status} ${JSON.stringify(data)}`
    );
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(getMongo()),
  providers: [
    Keycloak({
      issuer: envOrWarn("KEYCLOAK_ISSUER"),
      clientId: envOrWarn("KEYCLOAK_CLIENT_ID"),
      clientSecret: envOrWarn("KEYCLOAK_CLIENT_SECRET"),
      authorization: {
        params: { scope: "openid profile offline_access open-finance" },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // First sign-in: bring tokens from the Account into the JWT.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.tokenExpiresAt = account.expires_at;
        token.error = undefined;
        return token;
      }

      // Subsequent requests: check expiry; refresh if past or near expiry.
      const SAFETY_MARGIN_SECONDS = 30;
      const now = Math.floor(Date.now() / 1000);
      if (
        token.tokenExpiresAt &&
        token.tokenExpiresAt - SAFETY_MARGIN_SECONDS > now
      ) {
        return token;
      }
      if (!token.refreshToken) {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }
      try {
        const refreshed = await refreshAccessToken(token.refreshToken);
        return {
          ...token,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiresAt: refreshed.expiresAt,
          error: undefined,
        };
      } catch (err) {
        console.error("[auth] refresh token failed:", err);
        return { ...token, error: "RefreshAccessTokenError" as const };
      }
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      if (token.error === "RefreshAccessTokenError") {
        // Surface the error and clear the stale access token so route handlers
        // fail-fast with a clear "please re-login" response.
        session.error = "RefreshAccessTokenError";
        session.accessToken = undefined;
      } else {
        session.accessToken = token.accessToken;
      }
      session.refreshToken = token.refreshToken;
      session.tokenExpiresAt = token.tokenExpiresAt;
      return session;
    },
  },
});

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session;
}
