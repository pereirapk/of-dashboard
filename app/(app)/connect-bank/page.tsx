import { ConnectCumbucaButton } from "@/components/auth/ConnectCumbucaButton";

export default function ConnectBankPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  return <ConnectBankPageBody searchParams={searchParams} />;
}

async function ConnectBankPageBody({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const reason = params.reason;

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Conectar Open Finance</h1>
        <p className="text-sm opacity-70">
          Nenhuma conta está conectada. Autorize o acesso aos seus dados via
          Open Finance pra ver saldos, transações e gastos.
        </p>
        {reason === "ensure_failed" && (
          <p className="text-xs text-red-500/80 rounded-md border border-red-500/30 p-3">
            Não conseguimos confirmar seu consentimento na última tentativa.
            Tente reautorizar abaixo.
          </p>
        )}
        <ConnectCumbucaButton />
      </div>
    </main>
  );
}
