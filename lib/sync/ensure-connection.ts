import type { Db } from "mongodb";
import { getDb } from "@/lib/mongo";
import {
  upsertBankConnection,
  findActiveConnectionsByUser,
} from "@/lib/repositories/connections";
import { ConsentStatusResponse } from "@/lib/mcp/tools";
import { callMcpTool } from "@/lib/mcp/client";
import { ensureMcpCallLogIndexes } from "@/lib/repositories/mcp-call-logs";

let indexesEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  await ensureMcpCallLogIndexes(db);
  indexesEnsured = true;
}

/**
 * On every authed page load, ensure the user has an up-to-date bank_connection.
 * Idempotent — short-circuits if an active connection already exists.
 */
export async function ensureBankConnection(opts: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date;
}): Promise<{ active: number; created: boolean }> {
  const db = await getDb();
  await ensureIndexes(db);

  const existing = await findActiveConnectionsByUser(db, opts.userId);
  if (existing.length > 0) {
    return { active: existing.length, created: false };
  }

  const parsed = await callMcpTool(
    {
      db,
      userId: opts.userId,
      bankConnectionId: null,
      syncRunId: null,
      triggeredBy: "callback",
      accessToken: opts.accessToken,
      quotaBucket: "consent_status",
    },
    "get_consent_status",
    {},
    ConsentStatusResponse
  );

  const normalizedStatus =
    parsed.status === "active"
      ? "active"
      : parsed.status === "expired"
      ? "expired"
      : parsed.status === "revoked"
      ? "revoked"
      : "error";

  await upsertBankConnection(db, {
    userId: opts.userId,
    institutionId: parsed.institution_name,
    institutionDisplayName: parsed.institution_name.toUpperCase(),
    status: normalizedStatus,
    consentExpiresAt: parsed.expires_at ? new Date(parsed.expires_at) : null,
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    tokenExpiresAt: opts.tokenExpiresAt,
  });

  return { active: 1, created: true };
}
