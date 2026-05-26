import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/mcp/client", () => ({ callMcpTool: vi.fn() }));

import { callMcpTool } from "@/lib/mcp/client";
import { revokeConsentForConnection } from "@/lib/mcp/revoke-consent";

beforeEach(() => {
  vi.mocked(callMcpTool).mockReset();
});

describe("revokeConsentForConnection", () => {
  it("calls callMcpTool with name 'revoke_consent' and quotaBucket 'revoke_consent'", async () => {
    vi.mocked(callMcpTool).mockResolvedValueOnce({});
    const fakeDb = {} as unknown as Parameters<typeof revokeConsentForConnection>[0]["db"];

    await revokeConsentForConnection({
      db: fakeDb,
      userId: "u1",
      bankConnectionId: "conn-1",
      accessToken: "tok-xyz",
    });

    expect(callMcpTool).toHaveBeenCalledTimes(1);
    const args = vi.mocked(callMcpTool).mock.calls[0];
    expect(args[1]).toBe("revoke_consent");
    expect(args[2]).toEqual({});
    expect(args[0]).toMatchObject({
      userId: "u1",
      bankConnectionId: "conn-1",
      syncRunId: null,
      triggeredBy: "manual",
      accessToken: "tok-xyz",
      quotaBucket: "revoke_consent",
    });
  });

  it("propagates errors from callMcpTool", async () => {
    vi.mocked(callMcpTool).mockRejectedValueOnce(new Error("MCP refused"));
    await expect(
      revokeConsentForConnection({
        db: {} as unknown as Parameters<typeof revokeConsentForConnection>[0]["db"],
        userId: "u1",
        bankConnectionId: "conn-1",
        accessToken: "tok",
      })
    ).rejects.toThrow("MCP refused");
  });
});
