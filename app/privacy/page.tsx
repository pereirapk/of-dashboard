export const metadata = {
  title: "Privacidade — Cumbuca Dashboard",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Política de Privacidade</h1>
        <p className="text-xs opacity-60">
          Versão preliminar — atualizada em 22/05/2026
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <p>
          Este app (&ldquo;Cumbuca Dashboard&rdquo;) acessa seus dados
          financeiros via Open Finance regulado pelo Banco Central do Brasil,
          intermediado pela Cumbuca. Acesso requer seu consentimento explícito
          durante o login.
        </p>

        <h2 className="text-base font-medium mt-6">Dados coletados</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Identificadores da sua conta Cumbuca (e-mail, ID interno)</li>
          <li>
            Saldos e transações das contas e cartões autorizados via Open
            Finance
          </li>
          <li>
            CNPJ/CPF de contrapartes de Pix (armazenado apenas como hash
            irreversível)
          </li>
        </ul>

        <h2 className="text-base font-medium mt-6">Como usamos</h2>
        <p>
          Os dados são usados exclusivamente para exibir seu dashboard
          financeiro pessoal. Não compartilhamos com terceiros. Não vendemos.
          Não treinamos modelos com seus dados.
        </p>

        <h2 className="text-base font-medium mt-6">Categorização</h2>
        <p>
          Transações são categorizadas em duas etapas: (1) regras
          determinísticas baseadas em códigos MCC (categorias de
          estabelecimento padrão da indústria) e (2) classificação por modelo
          de linguagem (Claude da Anthropic). A chamada ao modelo inclui as
          descrições das transações; nada é retido pela Anthropic após a
          resposta.
        </p>

        <h2 className="text-base font-medium mt-6">Armazenamento</h2>
        <p>
          Dados ficam em MongoDB Atlas. Tokens OAuth e PII são criptografados
          em repouso (AES-256-GCM). Logs de chamadas ao MCP expiram
          automaticamente após 30 dias (TTL).
        </p>

        <h2 className="text-base font-medium mt-6">
          Seus direitos (LGPD Art. 18)
        </h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Acesso</strong>: você vê todos os seus dados na própria
            interface do app.
          </li>
          <li>
            <strong>Exclusão</strong>: vá em Configurações → Zona de perigo →
            Excluir minha conta. A exclusão é imediata e irreversível.
          </li>
          <li>
            <strong>Revogação de consentimento</strong>: junto com a exclusão,
            revogamos automaticamente o consent Open Finance na Cumbuca.
          </li>
        </ul>

        <h2 className="text-base font-medium mt-6">Contato</h2>
        <p>
          Para qualquer questão sobre privacidade, entre em contato com o
          responsável pelo app.
        </p>
      </section>

      <footer className="text-xs opacity-50 border-t border-foreground/10 pt-4">
        Documento sujeito a revisão jurídica antes de uso comercial. Esta
        versão é placeholder para o MVP.
      </footer>
    </main>
  );
}
