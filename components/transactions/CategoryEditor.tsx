"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";
import { CategoryBadge, type CategoryMeta } from "./CategoryBadge";
import { Icon, ICON_NAMES } from "@/lib/icons";

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function CategoryEditor({
  transactionId,
  current,
  source,
  userCategories: initialUserCategories,
}: {
  transactionId: string;
  current: string | null;
  source: "mcc" | "llm" | "user" | null;
  userCategories: CategoryMeta[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<string | null | undefined>(
    undefined
  );
  const [pending, setPending] = useState(false);
  const [userCategories, setUserCategories] = useState(initialUserCategories);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [newColor, setNewColor] = useState("#a855f7");
  const [createError, setCreateError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search input when the dropdown opens.
  useEffect(() => {
    if (open && !creating) {
      searchRef.current?.focus();
    }
  }, [open, creating]);

  function closeDropdown() {
    closeDropdown();
    setSearch("");
    setCreating(false);
    setCreateError(null);
  }

  async function patch(slug: string | null) {
    setOptimistic(slug);
    setPending(true);
    closeDropdown();
    try {
      const r = await fetch(`/api/transactions/${transactionId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: slug }),
      });
      if (!r.ok) {
        setOptimistic(undefined);
        return;
      }
      router.refresh();
    } catch {
      setOptimistic(undefined);
    } finally {
      setPending(false);
    }
  }

  async function createAndApply(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!newLabel.trim()) {
      setCreateError("Nome obrigatório.");
      return;
    }
    try {
      const r = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labelPt: newLabel.trim(),
          icon: newIcon.trim(),
          color: newColor,
        }),
      });
      const data = (await r.json()) as
        | { ok: true; category: CategoryMeta }
        | { ok: false; error?: string };
      if (!r.ok || !data.ok) {
        setCreateError((data as { error?: string }).error ?? "Erro ao criar.");
        return;
      }
      const cat = (data as { ok: true; category: CategoryMeta }).category;
      setUserCategories((prev) => [...prev, cat]);
      setCreating(false);
      setNewLabel("");
      setNewIcon("");
      void patch(cat.slug);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  }

  function openCreateForm() {
    setCreating(true);
    if (search.trim() && !newLabel) setNewLabel(search.trim());
  }

  const visibleSlug = optimistic !== undefined ? optimistic : current;
  const visibleSource: "mcc" | "llm" | "user" | null =
    optimistic !== undefined && optimistic !== null
      ? "user"
      : optimistic === null
      ? null
      : source;

  const nq = normalize(search);
  const matches = (label: string) => nq === "" || normalize(label).includes(nq);
  const filteredSeeded = CATEGORY_SEEDS.filter((c) => matches(c.labelPt));
  const filteredUser = userCategories.filter((c) => matches(c.labelPt));
  const totalMatches = filteredSeeded.length + filteredUser.length;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => (open ? closeDropdown() : setOpen(true))}
        disabled={pending}
        className="cursor-pointer disabled:opacity-50"
        aria-label="Mudar categoria"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CategoryBadge
          slug={visibleSlug}
          source={visibleSource}
          userCategories={userCategories}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-20 left-0 top-full mt-1 w-72 max-h-96 overflow-auto rounded-md border border-foreground/15 bg-background shadow-lg p-1"
        >
          {!creating && (
            <div className="p-1 sticky top-0 bg-background z-10 -m-1 mb-1 border-b border-foreground/10">
              <input
                ref={searchRef}
                type="search"
                placeholder="Buscar categoria…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    closeDropdown();
                  }
                }}
                className="w-full rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-xs"
              />
            </div>
          )}

          {!creating && (
            <>
              {nq === "" && (
                <button
                  type="button"
                  role="option"
                  aria-selected={visibleSlug === null}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-foreground/10"
                  onClick={() => patch(null)}
                >
                  — Sem categoria
                </button>
              )}
              {filteredSeeded.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  role="option"
                  aria-selected={visibleSlug === c.slug}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-foreground/10 flex items-center gap-2"
                  onClick={() => patch(c.slug)}
                >
                  <Icon name={c.icon} size={14} color={c.color} />
                  <span>{c.labelPt}</span>
                </button>
              ))}
              {filteredUser.length > 0 && (
                <div className="border-t border-foreground/10 my-1" />
              )}
              {filteredUser.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  role="option"
                  aria-selected={visibleSlug === c.slug}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-foreground/10 flex items-center gap-2"
                  onClick={() => patch(c.slug)}
                >
                  <Icon name={c.icon} size={14} color={c.color} />
                  <span>{c.labelPt}</span>
                  <span className="ml-auto opacity-40 text-[10px]">custom</span>
                </button>
              ))}
              {totalMatches === 0 && nq !== "" && (
                <p className="text-xs opacity-60 px-2 py-2">
                  Nenhuma categoria encontrada.
                </p>
              )}
              <div className="border-t border-foreground/10 my-1" />
              <button
                type="button"
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-foreground/10 opacity-80"
                onClick={openCreateForm}
              >
                + Nova categoria{search.trim() ? ` “${search.trim()}”` : ""}
              </button>
            </>
          )}

          {creating && (
            <form onSubmit={createAndApply} className="p-2 space-y-2">
              <input
                type="text"
                placeholder="Nome (ex: Pet Shop)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                maxLength={60}
                autoFocus
                className="w-full rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-xs"
              />
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-md border border-foreground/15 bg-background px-1.5">
                  <Icon
                    name={newIcon || "help-circle"}
                    size={14}
                    color={newColor}
                  />
                  <input
                    list="lucide-icon-list"
                    type="text"
                    placeholder="ícone"
                    value={newIcon}
                    onChange={(e) =>
                      setNewIcon(e.target.value.trim().toLowerCase())
                    }
                    maxLength={32}
                    className="w-24 bg-transparent py-1.5 text-xs focus:outline-none"
                    aria-label="Nome do ícone (lucide)"
                  />
                </div>
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-8 w-12 rounded-md border border-foreground/15 bg-transparent"
                  aria-label="Cor"
                />
                <button
                  type="submit"
                  className="flex-1 rounded-md bg-foreground/10 px-2 py-1.5 text-xs hover:bg-foreground/20"
                >
                  Criar e aplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setCreateError(null);
                  }}
                  className="rounded-md px-2 py-1.5 text-xs hover:bg-foreground/10"
                  aria-label="Cancelar"
                >
                  ×
                </button>
              </div>
              <datalist id="lucide-icon-list">
                {ICON_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p className="text-[10px] opacity-50">
                Nome de ícone Lucide (ex: paw-print, coffee, dumbbell).
              </p>
              {createError && (
                <p className="text-[10px] text-red-500">{createError}</p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
