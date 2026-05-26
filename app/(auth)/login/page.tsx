import Link from "next/link";
import { SignInWithCumbuca } from "@/components/auth/SignInWithCumbuca";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Cumbuca Dashboard</h1>
        <p className="text-sm opacity-70">
          Entre com sua conta Cumbuca para autorizar o acesso aos seus dados
          do Open Finance.
        </p>
        <SignInWithCumbuca />
        <p className="text-xs opacity-50">
          Ao entrar, você autoriza este app a ler seus dados financeiros via
          Cumbuca (Open Finance). Você pode revogar a qualquer momento.{" "}
          <Link href="/privacy" className="underline">
            Política de Privacidade
          </Link>
        </p>
      </div>
    </main>
  );
}
