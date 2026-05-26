import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findAccountsByUser } from "@/lib/repositories/accounts";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import Link from "next/link";
import { Money } from "@/components/Money";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AccountsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const db = await getDb();
  const [accounts, connections] = await Promise.all([
    findAccountsByUser(db, userId),
    findActiveConnectionsByUser(db, userId),
  ]);

  const checking = accounts.filter((a) => a.kind === "account");
  const cards = accounts.filter((a) => a.kind === "credit_card");

  return (
    <main className="p-6 space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Contas</h2>
        <p className="text-xs opacity-60">
          Conexões Open Finance e suas contas / cartões
        </p>
      </header>

      <section className="space-y-2">
        <h3 className="text-sm font-medium opacity-80">Conexões</h3>
        {connections.length === 0 ? (
          <p className="text-xs opacity-60">Nenhuma conexão.</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li
                key={c._id.toHexString()}
                className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium">{c.institutionDisplayName}</p>
                  <p className="text-xs opacity-70">
                    Status: <span className="font-mono">{c.status}</span>
                    {c.lastSyncAt
                      ? ` · Última sync: ${dateFmt.format(c.lastSyncAt)}`
                      : " · Nunca sincronizado"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium opacity-80">
          Contas correntes / poupança
        </h3>
        {checking.length === 0 ? (
          <p className="text-xs opacity-60">Nenhuma conta.</p>
        ) : (
          <ul className="space-y-2">
            {checking.map((a) => (
              <li
                key={a._id.toHexString()}
                className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{a.displayName}</p>
                    <p className="text-xs opacity-70">
                      {a.institutionName.toUpperCase()} · Ag. {a.branchCode} ·
                      Conta {a.number}-{a.checkDigit}
                    </p>
                  </div>
                  <Link
                    href={`/transactions?account=${a._id.toHexString()}`}
                    className="text-xs underline opacity-70 hover:opacity-100 shrink-0"
                  >
                    Ver transações →
                  </Link>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="opacity-60">Disponível</p>
                    <p className="tabular-nums">
                      <Money cents={a.balanceComponents?.available ?? 0} />
                    </p>
                  </div>
                  <div>
                    <p className="opacity-60">Bloqueado</p>
                    <p className="tabular-nums">
                      <Money cents={a.balanceComponents?.blocked ?? 0} />
                    </p>
                  </div>
                  <div>
                    <p className="opacity-60">Investido</p>
                    <p className="tabular-nums">
                      <Money
                        cents={
                          a.balanceComponents?.automaticallyInvested ?? 0
                        }
                      />
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm font-medium">
                  Total: <Money cents={a.currentBalance ?? 0} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium opacity-80">Cartões de crédito</h3>
        {cards.length === 0 ? (
          <p className="text-xs opacity-60">Nenhum cartão.</p>
        ) : (
          <ul className="space-y-2">
            {cards.map((a) => (
              <li
                key={a._id.toHexString()}
                className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-medium">{a.displayName}</p>
                  <p className="text-xs opacity-70">
                    {a.institutionName.toUpperCase()} ·{" "}
                    {a.creditCardNetwork} · {a.productType}
                  </p>
                </div>
                <Link
                  href={`/transactions?account=${a._id.toHexString()}`}
                  className="text-xs underline opacity-70 hover:opacity-100"
                >
                  Ver transações →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
