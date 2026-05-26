import { auth } from "@/lib/auth";
import { DeleteAccountSection } from "@/components/settings/DeleteAccountSection";
import { SignOutButton } from "@/components/settings/SignOutButton";

export default async function SettingsPage() {
  const session = await auth();
  return (
    <main className="p-6 space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Configurações</h2>
        <p className="text-xs opacity-60">Conta e dados</p>
      </header>

      <section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 space-y-2">
        <h3 className="text-sm font-medium">Sua conta</h3>
        <p className="text-xs opacity-70">
          E-mail:{" "}
          <span className="font-mono">{session?.user?.email ?? "—"}</span>
        </p>
        <p className="text-xs opacity-70">
          ID: <span className="font-mono">{session?.user?.id}</span>
        </p>
      </section>

      <section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 space-y-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Sessão</h3>
          <p className="text-xs opacity-70">
            Sair desconecta este navegador. O consentimento Open Finance fica intacto.
          </p>
        </div>
        <SignOutButton />
      </section>

      <DeleteAccountSection />
    </main>
  );
}
