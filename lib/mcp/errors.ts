export type McpErrorKind =
  | "transport"
  | "auth"
  | "mcp_tool_error"
  | "schema_mismatch"
  | "timeout"
  | "quota_exceeded";

export class McpError extends Error {
  constructor(
    message: string,
    public kind: McpErrorKind,
    public details?: { code?: string | number; raw?: unknown }
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class QuotaExceededError extends McpError {
  constructor(
    public quotaBucket: string,
    public limit: number,
    public used: number
  ) {
    super(
      `Quota exceeded for "${quotaBucket}": used ${used}/${limit} this month`,
      "quota_exceeded",
      { code: quotaBucket }
    );
    this.name = "QuotaExceededError";
  }
}
