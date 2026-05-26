import { Money } from "@/components/Money";

export interface KpiCardProps {
  title: string;
  cents: number;
  helper?: string;
  tone?: "neutral" | "positive" | "negative";
}

export function KpiCard({ title, cents, helper, tone = "neutral" }: KpiCardProps) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
      ? "text-red-500"
      : "";
  return (
    <div className="rounded-md border border-foreground/10 p-4 space-y-1 flex flex-col">
      <p className="text-xs uppercase tracking-wide opacity-60">{title}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        <Money cents={cents} />
      </p>
      {helper && <p className="text-xs opacity-60">{helper}</p>}
    </div>
  );
}
