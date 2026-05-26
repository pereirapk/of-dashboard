import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import { runSync, type RunSyncResult } from "@/lib/sync/runner";
import {
  enforceRateLimit,
  ensureRateLimitIndexes,
  RateLimitedError,
} from "@/lib/repositories/rate-limits";
import { ensureMcpCallLogIndexes } from "@/lib/repositories/mcp-call-logs";

let indexesEnsured = false;
async function bootstrapIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const db = await getDb();
  await Promise.all([
    ensureRateLimitIndexes(db),
    ensureMcpCallLogIndexes(db),
  ]);
  indexesEnsured = true;
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  if (!session.accessToken) {
    return NextResponse.json(
      { ok: false, error: "no_access_token" },
      { status: 400 }
    );
  }

  await bootstrapIndexes();
  const db = await getDb();

  // 1 manual sync per minute per user
  try {
    await enforceRateLimit(db, `sync:${session.user.id}`, 60);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json(
        {
          ok: false,
          error: "rate_limited",
          retryAfterSeconds: err.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        }
      );
    }
    throw err;
  }

  const connections = await findActiveConnectionsByUser(db, session.user.id);
  if (connections.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_active_connection" },
      { status: 412 }
    );
  }

  const results: Array<RunSyncResult & { bankConnectionId: string }> = [];
  for (const conn of connections) {
    try {
      const r = await runSync(db, conn, session.accessToken, {
        triggeredBy: "manual",
      });
      results.push({ ...r, bankConnectionId: conn._id.toString() });
    } catch (err) {
      results.push({
        bankConnectionId: conn._id.toString(),
        syncRunId: "(crashed)",
        status: "error",
        stats: {
          transactionsFetched: 0,
          transactionsNew: 0,
          accountsUpdated: 0,
          snapshotsWritten: 0,
          mccCategorized: 0,
          llmCategorized: 0,
          errors: [
            {
              tool: "(runner)",
              kind: "transport",
              message:
                err instanceof Error ? err.message : String(err),
            },
          ],
        },
      });
    }
  }

  const ok = results.every((r) => r.status !== "error");
  return NextResponse.json({ ok, results });
}
