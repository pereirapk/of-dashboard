"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";

export interface AccountOption {
  id: string;
  label: string;
}

export function TransactionFilters({
  accounts,
}: {
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  function applyFilter(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`/transactions?${params.toString()}`);
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    applyFilter("q", q.trim() || null);
  }

  function clearAll() {
    router.push("/transactions");
    setQ("");
  }

  const activeFilterCount = Array.from(searchParams.keys()).filter(
    (k) => k !== "page"
  ).length;

  return (
    <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 flex flex-wrap items-center gap-2">
      <form onSubmit={applySearch} className="flex-1 min-w-[200px]">
        <input
          type="search"
          placeholder="Buscar descrição…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
        />
      </form>

      <Select
        value={searchParams.get("category") ?? ""}
        onChange={(e) => applyFilter("category", e.target.value || null)}
      >
        <option value="">Todas as categorias</option>
        <option value="null">Sem categoria</option>
        {CATEGORY_SEEDS.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.icon} {c.labelPt}
          </option>
        ))}
      </Select>

      <Select
        value={searchParams.get("source") ?? ""}
        onChange={(e) => applyFilter("source", e.target.value || null)}
      >
        <option value="">Todas as origens</option>
        <option value="account">Conta</option>
        <option value="credit_card">Cartão</option>
      </Select>

      <Select
        value={searchParams.get("account") ?? ""}
        onChange={(e) => applyFilter("account", e.target.value || null)}
      >
        <option value="">Todas as contas</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </Select>

      <input
        type="date"
        value={searchParams.get("from") ?? ""}
        onChange={(e) => applyFilter("from", e.target.value || null)}
        className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
      />
      <span className="text-xs opacity-60">→</span>
      <input
        type="date"
        value={searchParams.get("to") ?? ""}
        onChange={(e) => applyFilter("to", e.target.value || null)}
        className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
      />

      {activeFilterCount > 0 && (
        <Button variant="secondary" onClick={clearAll}>
          Limpar
        </Button>
      )}
    </div>
  );
}
