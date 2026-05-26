"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { centsToBrl } from "@/lib/format/money";

export interface TrendPoint {
  monthKey: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm opacity-60 p-3">Sem dados suficientes.</p>;
  }
  const chartData = data.map((d) => ({
    month: d.monthKey.slice(5),
    Receita: d.inflowCents / 100,
    Gastos: d.outflowCents / 100,
    Líquido: d.netCents / 100,
  }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) =>
              typeof v === "number" ? centsToBrl(v * 100) : String(v)
            }
          />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? centsToBrl(value * 100) : String(value)
            }
          />
          <Line
            type="monotone"
            dataKey="Receita"
            stroke="#16a34a"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="Gastos"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="Líquido"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
