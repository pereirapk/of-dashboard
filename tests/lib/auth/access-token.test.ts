import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { MongoClient, type Db, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  ensureFreshAccessToken,
  AccessTokenError,
} from "@/lib/auth/access-token";
import { encrypt } from "@/lib/crypto";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const originalFetch = global.fetch;

beforeAll(async () => {
  process.env.OPENFINANCE_TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.KEYCLOAK_ISSUER = "https://idc.test/realms/test";
  process.env.KEYCLOAK_CLIENT_ID = "test-client";
  process.env.KEYCLOAK_CLIENT_SECRET = "test-secret";
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("test");
}, 120000);

afterAll(async () => {
  global.fetch = originalFetch;
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("bank_connections").deleteMany({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedConn(input: {
  accessToken?: string;
  refreshToken?: string | null;
  tokenExpiresAt: Date;
}): Promise<ObjectId> {
  const result = await db.collection("bank_connections").insertOne({
    userId: "u1",
    institutionId: "test",
    status: "active",
    encryptedAccessToken: input.accessToken
      ? encrypt(input.accessToken, "OPENFINANCE_TOKEN_KEY")
      : null,
    encryptedRefreshToken:
      input.refreshToken == null
        ? null
        : encrypt(input.refreshToken, "OPENFINANCE_TOKEN_KEY"),
    tokenExpiresAt: input.tokenExpiresAt,
    quotaUsage: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  return result.insertedId;
}

describe("ensureFreshAccessToken", () => {
  it("returns the current token when not near expiry; no fetch", async () => {
    const id = await seedConn({
      accessToken: "still-valid",
      refreshToken: "ref",
      tokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // +5 min
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const token = await ensureFreshAccessToken(db, id);
    expect(token).toBe("still-valid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes when expired and writes back encrypted new tokens", async () => {
    const id = await seedConn({
      accessToken: "expired",
      refreshToken: "ref-1",
      tokenExpiresAt: new Date(Date.now() - 60 * 1000), // 1 min ago
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "fresh-token",
        refresh_token: "ref-2",
        expires_in: 3600,
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const token = await ensureFreshAccessToken(db, id);
    expect(token).toBe("fresh-token");

    const stored = await db.collection("bank_connections").findOne({ _id: id });
    expect(stored?.encryptedAccessToken).not.toBe(
      (await db.collection("bank_connections").findOne({ _id: id }))
        ?.encryptedAccessToken
        ? undefined
        : null
    );
    // Verify fetch called with correct shape
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe("https://idc.test/realms/test/protocol/openid-connect/token");
    expect(callArgs[1]?.method).toBe("POST");
  });

  it("throws AccessTokenError('refresh_failed') when Keycloak returns 4xx/5xx", async () => {
    const id = await seedConn({
      accessToken: "expired",
      refreshToken: "ref-1",
      tokenExpiresAt: new Date(Date.now() - 60 * 1000),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "invalid_grant" }),
      })
    );
    await expect(ensureFreshAccessToken(db, id)).rejects.toBeInstanceOf(
      AccessTokenError
    );
  });

  it("throws AccessTokenError('missing') when there's no refresh token but access is expired", async () => {
    const id = await seedConn({
      accessToken: "expired",
      refreshToken: null,
      tokenExpiresAt: new Date(Date.now() - 60 * 1000),
    });
    try {
      await ensureFreshAccessToken(db, id);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AccessTokenError);
      expect((err as AccessTokenError).reason).toBe("missing");
    }
  });

  it("throws AccessTokenError('missing') when the connection is not found", async () => {
    try {
      await ensureFreshAccessToken(db, new ObjectId());
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AccessTokenError);
      expect((err as AccessTokenError).reason).toBe("missing");
    }
  });
});
