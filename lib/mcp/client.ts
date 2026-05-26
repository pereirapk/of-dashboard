import { ulid } from "ulid";
import { z } from "zod";
import { ObjectId, type Db } from "mongodb";
import { McpError, QuotaExceededError } from "./errors";
import { QUOTA_LIMITS, currentMonthKey, type QuotaBucket } from "./quotas";
import {
  insertRunningLog,
  finishLogOk,
  finishLogError,
} from "@/lib/repositories/mcp-call-logs";
import { invokeTool } from "./_transport";

const MCP_URL = process.env.CUMBUCA_MCP_URL ?? "https://mcp.cumbuca.com/mcp";

export interface CallMcpContext {
  db: Db;
  userId: string;
  bankConnectionId: string | null;
  syncRunId: string | null;
  triggeredBy: "manual" | "cron" | "callback";
  accessToken: string;
  quotaBucket: QuotaBucket | null;
  bypassCache?: boolean;
}

export async function callMcpTool<S extends z.ZodType>(
  ctx: CallMcpContext,
  tool: string,
  args: Record<string, unknown>,
  schema: S
): Promise<z.infer<S>> {
  const requestId = ulid();
  const startedAt = new Date();

  // 1. Quota gate — only if bucket has documented limit and not bypassing
  if (ctx.quotaBucket && !ctx.bypassCache && ctx.bankConnectionId) {
    const limit = QUOTA_LIMITS[ctx.quotaBucket];
    if (typeof limit === "number") {
      const used = await readQuotaUsage(ctx.db, ctx.bankConnectionId, ctx.quotaBucket);
      if (used >= limit) {
        throw new QuotaExceededError(ctx.quotaBucket, limit, used);
      }
    }
  }

  // 2. Insert running log
  const logId = await insertRunningLog(ctx.db, {
    requestId,
    userId: ctx.userId,
    bankConnectionId: ctx.bankConnectionId,
    syncRunId: ctx.syncRunId,
    tool,
    quotaBucket: ctx.quotaBucket,
    quotaConsumed: !ctx.bypassCache,
    triggeredBy: ctx.triggeredBy,
    startedAt,
    argsRedacted: redactArgs(args),
  });

  try {
    // 3. Make the call
    const raw = await invokeTool({
      url: MCP_URL,
      accessToken: ctx.accessToken,
      tool,
      args,
    });

    // 4. Extract text content
    const textContent = raw.content?.find((c) => c.type === "text")?.text;
    if (!textContent) {
      throw new McpError(`Tool "${tool}" returned no text content`, "mcp_tool_error", { raw });
    }

    // 5. JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      throw new McpError(`Tool "${tool}" returned non-JSON text`, "mcp_tool_error", { raw: textContent });
    }

    // 6. Schema validate
    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new McpError(
        `Tool "${tool}" response did not match schema: ${validation.error.message}`,
        "schema_mismatch",
        { raw: parsed }
      );
    }

    // 7. Log ok + increment quota
    const durationMs = Date.now() - startedAt.getTime();
    await finishLogOk(ctx.db, logId, durationMs, JSON.stringify(parsed).slice(0, 2048));
    if (ctx.quotaBucket && !ctx.bypassCache && ctx.bankConnectionId) {
      await incrementQuotaUsage(ctx.db, ctx.bankConnectionId, ctx.quotaBucket);
    }

    return validation.data as z.infer<S>;
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const mcpErr =
      err instanceof McpError
        ? err
        : new McpError(err instanceof Error ? err.message : String(err), "transport");
    await finishLogError(
      ctx.db,
      logId,
      durationMs,
      mcpErr.kind,
      mcpErr.message,
      mcpErr.details?.code != null ? String(mcpErr.details.code) : null,
      mcpErr.details?.raw ?? null
    );
    throw mcpErr;
  }
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && /token|secret|password|cpf/i.test(k)) {
      out[k] = "***";
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function readQuotaUsage(
  db: Db,
  bankConnectionId: string,
  bucket: QuotaBucket
): Promise<number> {
  const conn = await db
    .collection("bank_connections")
    .findOne(
      { _id: idOrString(bankConnectionId) as unknown as never },
      { projection: { quotaUsage: 1 } }
    );
  const usage = (conn?.quotaUsage ?? {}) as Record<string, number | string>;
  const month = currentMonthKey();
  if (usage.month !== month) return 0;
  const v = usage[bucket];
  return typeof v === "number" ? v : 0;
}

async function incrementQuotaUsage(
  db: Db,
  bankConnectionId: string,
  bucket: QuotaBucket
): Promise<void> {
  const month = currentMonthKey();
  const existing = await db
    .collection("bank_connections")
    .findOne(
      { _id: idOrString(bankConnectionId) as unknown as never },
      { projection: { quotaUsage: 1 } }
    );
  const current = (existing?.quotaUsage ?? {}) as Record<string, number | string>;
  if (current.month !== month) {
    await db.collection("bank_connections").updateOne(
      { _id: idOrString(bankConnectionId) as unknown as never },
      { $set: { quotaUsage: { month, [bucket]: 1 } } }
    );
  } else {
    await db.collection("bank_connections").updateOne(
      { _id: idOrString(bankConnectionId) as unknown as never },
      { $inc: { [`quotaUsage.${bucket}`]: 1 } }
    );
  }
}

function idOrString(id: string) {
  // bankConnectionId may be a hex ObjectId string or some other identifier;
  // try ObjectId first, fall back to raw string.
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}
