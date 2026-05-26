import { z } from "zod";
import type { Db } from "mongodb";
import { callMcpTool } from "./client";

/**
 * MCP `revoke_consent` returns no meaningful body; we just need to know it
 * succeeded. Accept any shape.
 */
const RevokeConsentResponse = z.looseObject({});

/**
 * Revoke the Open Finance consent for a specific bank_connection. Irreversible
 * at the Cumbuca side. Caller must already have decrypted the access token.
 */
export async function revokeConsentForConnection(opts: {
  db: Db;
  userId: string;
  bankConnectionId: string;
  accessToken: string;
}): Promise<void> {
  await callMcpTool(
    {
      db: opts.db,
      userId: opts.userId,
      bankConnectionId: opts.bankConnectionId,
      syncRunId: null,
      triggeredBy: "manual",
      accessToken: opts.accessToken,
      quotaBucket: "revoke_consent",
    },
    "revoke_consent",
    {},
    RevokeConsentResponse
  );
}
