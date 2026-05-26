import { getDb } from "@/lib/mongo";
import { findRecentLogs } from "@/lib/repositories/mcp-call-logs";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const dynamic = "force-dynamic";

export default async function DevLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const db = await getDb();
  const logs = await findRecentLogs(db, {
    userId: get("user"),
    tool: get("tool"),
    status: get("status") as "ok" | "error" | "running" | "retry" | undefined,
    errorKind: get("kind"),
    limit: 100,
  });

  return (
    <main className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">/dev/logs — MCP call logs</h1>
        <p className="text-xs opacity-60">
          Últimas 100 chamadas, mais novas primeiro. Filtros via URL:{" "}
          <code className="font-mono text-[10px] bg-foreground/10 px-1">
            ?tool=list_accounts&amp;status=error&amp;user=...
          </code>
        </p>
      </header>

      {logs.length === 0 ? (
        <p className="opacity-60 text-sm">Sem logs.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left opacity-70 border-b border-foreground/10">
            <tr>
              <th className="py-2 px-2 font-medium">Quando</th>
              <th className="py-2 px-2 font-medium">Tool</th>
              <th className="py-2 px-2 font-medium">Bucket</th>
              <th className="py-2 px-2 font-medium">Status</th>
              <th className="py-2 px-2 font-medium">Dur.</th>
              <th className="py-2 px-2 font-medium">User</th>
              <th className="py-2 px-2 font-medium">Erro</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr
                key={l._id.toHexString()}
                className="border-b border-foreground/5 hover:bg-foreground/[0.02]"
              >
                <td className="py-2 px-2 tabular-nums opacity-70 whitespace-nowrap">
                  {dateFmt.format(l.startedAt)}
                </td>
                <td className="py-2 px-2 font-mono">{l.tool}</td>
                <td className="py-2 px-2 font-mono opacity-70">
                  {l.quotaBucket ?? "—"}
                </td>
                <td className="py-2 px-2">
                  <span
                    className={
                      l.status === "ok"
                        ? "text-emerald-500"
                        : l.status === "error"
                        ? "text-red-500"
                        : "opacity-70"
                    }
                  >
                    {l.status}
                  </span>
                </td>
                <td className="py-2 px-2 tabular-nums opacity-70">
                  {l.durationMs ?? "—"}ms
                </td>
                <td className="py-2 px-2 font-mono opacity-50 truncate max-w-[12ch]">
                  {l.userId}
                </td>
                <td className="py-2 px-2 text-red-400 max-w-md truncate">
                  {l.errorKind ? (
                    <>
                      <span className="font-mono">{l.errorKind}</span>:{" "}
                      {l.errorMessage}
                    </>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="text-xs opacity-50 pt-4">
        Para detalhes de uma chamada, consulte o doc{" "}
        <code className="font-mono">mcp_call_logs</code> no Mongo Atlas pelo{" "}
        <code className="font-mono">requestId</code>.
      </footer>
    </main>
  );
}
