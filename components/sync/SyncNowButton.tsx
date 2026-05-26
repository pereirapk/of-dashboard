"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface SyncResultRow {
  bankConnectionId: string;
  syncRunId: string;
  status: "success" | "partial" | "error";
  stats: {
    transactionsFetched: number;
    transactionsNew: number;
    accountsUpdated: number;
    snapshotsWritten: number;
    mccCategorized: number;
    llmCategorized: number;
    errors: Array<{ tool: string; kind: string; message: string }>;
  };
}

interface SyncResponse {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
  results?: SyncResultRow[];
}

export function SyncNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [details, setDetails] = useState<SyncResponse | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  async function handleClick() {
    setBusy(true);
    setFeedback("Sincronizando…");
    setDetails(null);
    let succeeded = false;
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const data = (await r.json()) as SyncResponse;
      setDetails(data);
      if (!data.ok && data.error === "rate_limited") {
        setFeedback(
          `Aguarde ${data.retryAfterSeconds ?? "?"}s antes de tentar de novo.`
        );
      } else if (!data.ok && data.error === "no_active_connection") {
        setFeedback("Nenhuma conexão ativa.");
      } else if (data.results && data.results.length > 0) {
        const totalNew = data.results.reduce(
          (n, row) => n + row.stats.transactionsNew,
          0
        );
        const totalFetched = data.results.reduce(
          (n, row) => n + row.stats.transactionsFetched,
          0
        );
        const totalErrors = data.results.reduce(
          (n, row) => n + row.stats.errors.length,
          0
        );
        const totalMcc = data.results.reduce(
          (n, row) => n + row.stats.mccCategorized,
          0
        );
        const totalLlm = data.results.reduce(
          (n, row) => n + row.stats.llmCategorized,
          0
        );
        succeeded = totalFetched > 0 || data.ok;
        const parts = [
          `${totalNew} novas / ${totalFetched} fetched`,
          (totalMcc > 0 || totalLlm > 0) && `mcc:${totalMcc} · llm:${totalLlm}`,
          totalErrors > 0 && `${totalErrors} erro(s)`,
        ].filter(Boolean);
        setFeedback(parts.join(" · "));
      } else if (!data.ok) {
        setFeedback(`Erro: ${data.error ?? "desconhecido"}`);
      } else {
        setFeedback("Sincronizado.");
        succeeded = true;
      }
    } catch (err) {
      setFeedback(`Falha de rede: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (succeeded) {
        // Re-render server components so the dashboard picks up the new data.
        router.refresh();
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      {feedback && (
        <span className="text-xs opacity-70 truncate max-w-xs" title={feedback}>
          {feedback}
        </span>
      )}
      <Button disabled={busy} onClick={handleClick}>
        {busy ? "Sincronizando…" : "Sincronizar agora"}
      </Button>
      {details && (
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-xs underline opacity-60"
        >
          {showDetails ? "ocultar" : "detalhes"}
        </button>
      )}
      {showDetails && details && (
        <pre className="absolute right-0 top-12 max-w-xl bg-foreground/5 border border-foreground/10 rounded p-3 text-xs overflow-auto z-10">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}
