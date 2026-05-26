"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function DeleteAccountSection() {
  const [stage, setStage] = useState<"idle" | "confirm">("idle");
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setPending(true);
    setError(null);
    try {
      const r = await fetch("/api/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error ?? "Falha ao excluir.");
        return;
      }
      // Hard navigation forces the session cookie to clear via Auth.js.
      window.location.href = "/login";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
      <h3 className="text-sm font-medium text-red-500">Zona de perigo</h3>
      <p className="text-xs opacity-80">
        Excluir sua conta vai revogar o consentimento Open Finance na Cumbuca
        (irreversível pelo lado deles) e apagar permanentemente os seus dados
        deste app: transações, contas conectadas, categorias, perfil. Não tem
        como reverter.
      </p>

      {stage === "idle" && (
        <Button
          variant="secondary"
          onClick={() => setStage("confirm")}
          className="border-red-500/40 text-red-500 hover:bg-red-500/10"
        >
          Excluir minha conta
        </Button>
      )}

      {stage === "confirm" && (
        <div className="space-y-2">
          <p className="text-xs">
            Digite{" "}
            <code className="font-mono bg-red-500/20 px-1 py-0.5 rounded">
              EXCLUIR
            </code>{" "}
            para confirmar:
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm w-full"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              disabled={typed !== "EXCLUIR" || pending}
              onClick={doDelete}
              className="bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
            >
              {pending ? "Excluindo…" : "Confirmar exclusão"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStage("idle");
                setTyped("");
                setError(null);
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </section>
  );
}
