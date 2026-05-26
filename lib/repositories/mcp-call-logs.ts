import type { Db, ObjectId } from "mongodb";

export interface McpCallLogDoc {
  _id: ObjectId;
  requestId: string;
  userId: string;
  bankConnectionId: string | null;
  syncRunId: string | null;
  tool: string;
  quotaBucket: string | null;
  quotaConsumed: boolean;
  triggeredBy: "manual" | "cron" | "callback";
  startedAt: Date;
  durationMs: number | null;
  status: "running" | "ok" | "error" | "retry";
  errorKind: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  argsRedacted: unknown;
  responseSnippet: string | null;
  mcpRaw: unknown;
  createdAt: Date;
}

const COLLECTION = "mcp_call_logs";

export type InsertRunningInput = Omit<
  McpCallLogDoc,
  | "_id"
  | "durationMs"
  | "status"
  | "errorKind"
  | "errorCode"
  | "errorMessage"
  | "responseSnippet"
  | "mcpRaw"
  | "createdAt"
>;

export async function insertRunningLog(
  db: Db,
  input: InsertRunningInput
): Promise<ObjectId> {
  const now = new Date();
  const doc = {
    ...input,
    durationMs: null,
    status: "running" as const,
    errorKind: null,
    errorCode: null,
    errorMessage: null,
    responseSnippet: null,
    mcpRaw: null,
    createdAt: now,
  };
  const result = await db.collection<McpCallLogDoc>(COLLECTION).insertOne(
    doc as unknown as McpCallLogDoc
  );
  return result.insertedId;
}

export async function finishLogOk(
  db: Db,
  id: ObjectId,
  durationMs: number,
  responseSnippet: string
): Promise<void> {
  await db.collection<McpCallLogDoc>(COLLECTION).updateOne(
    { _id: id },
    { $set: { durationMs, status: "ok", responseSnippet } }
  );
}

export async function finishLogError(
  db: Db,
  id: ObjectId,
  durationMs: number,
  errorKind: string,
  errorMessage: string,
  errorCode: string | null,
  mcpRaw: unknown
): Promise<void> {
  await db.collection<McpCallLogDoc>(COLLECTION).updateOne(
    { _id: id },
    {
      $set: {
        durationMs,
        status: "error",
        errorKind,
        errorMessage,
        errorCode,
        mcpRaw,
      },
    }
  );
}

export interface LogFilter {
  userId?: string;
  tool?: string;
  status?: "running" | "ok" | "error" | "retry";
  errorKind?: string;
  limit?: number;
}

export async function findRecentLogs(
  db: Db,
  filter: LogFilter = {}
): Promise<McpCallLogDoc[]> {
  const q: Record<string, unknown> = {};
  if (filter.userId) q.userId = filter.userId;
  if (filter.tool) q.tool = filter.tool;
  if (filter.status) q.status = filter.status;
  if (filter.errorKind) q.errorKind = filter.errorKind;
  return db
    .collection<McpCallLogDoc>(COLLECTION)
    .find(q)
    .sort({ startedAt: -1 })
    .limit(filter.limit ?? 100)
    .toArray();
}

/** Idempotent index creation. Safe to call multiple times. */
export async function ensureMcpCallLogIndexes(db: Db): Promise<void> {
  const col = db.collection(COLLECTION);
  await Promise.all([
    col.createIndex({ userId: 1, startedAt: -1 }),
    col.createIndex({ syncRunId: 1 }),
    col.createIndex({ status: 1, startedAt: -1 }),
    col.createIndex({ quotaBucket: 1, startedAt: -1 }),
    // 30-day TTL on `createdAt`
    col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }),
  ]);
}
