import { centsToBrl } from "@/lib/format/money";

export function Money({ cents }: { cents: number }) {
  const negative = cents < 0;
  return (
    <span className={negative ? "text-red-500" : ""}>
      {centsToBrl(cents)}
    </span>
  );
}
