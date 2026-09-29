"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatAxisBaht } from "./format";

export interface ChartPoint {
  key: string;
  /** Axis label, e.g. "12 ก.ย." */
  label: string;
  /** Tooltip heading, e.g. "ศุกร์ 12 ก.ย. 2569" */
  title: string;
  sales: number;
  purchases: number;
}

const config = {
  sales: { label: tr("ขาย (รายรับ)"), color: "var(--chart-2)" },
  purchases: { label: tr("ซื้อ (รายจ่าย)"), color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Grouped columns: sales (left, --chart-2) vs purchases (right, --chart-3) per bucket.
 * Identity is carried by position + legend + tooltip labels, not colour alone.
 */
export function SalesPurchaseChart({ data, className }: { data: ChartPoint[]; className?: string }) {
  const max = data.reduce((m, d) => Math.max(m, d.sales, d.purchases), 0);
  const empty = max === 0;
  // An all-zero series would give five "0" ticks; use a nominal 0-10,000 baht scale instead.
  const top = empty ? 1_000_000 : max;
  const yWidth = Math.max(40, formatAxisBaht(top).length * 7 + 12);
  return (
    <div className="relative">
      {empty ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center text-sm text-muted-foreground">
          <span className="rounded-md bg-card/90 px-3 py-1.5">{tr("ยังไม่มีการขายหรือซื้อในช่วงนี้")}</span>
        </div>
      ) : null}
      <ChartContainer config={config} className={cn("aspect-auto h-[280px] w-full", className)}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%" accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={6} interval="preserveStartEnd" />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={yWidth}
            tickMargin={4}
            tickCount={5}
            allowDecimals={false}
            domain={empty ? [0, top] : [0, "auto"]}
            tickFormatter={(v: number) => formatAxisBaht(v)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.7 }}
            content={
              <ChartTooltipContent
                className="min-w-48"
                labelFormatter={(_, payload) => (payload?.[0]?.payload as ChartPoint | undefined)?.title ?? ""}
                formatter={(value, name, item) => {
                  const key = String(name) as keyof typeof config;
                  return (
                    <div className="flex w-full items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                      <span className="text-muted-foreground">{config[key]?.label ?? name}</span>
                      <span className="num ml-auto font-medium text-foreground">{formatBaht(Number(value))}</span>
                    </div>
                  );
                }}
              />
            }
          />
          <ChartLegend verticalAlign="top" align="right" itemSorter={null} content={<ChartLegendContent className="justify-end pb-4 text-sm" />} />
          <Bar dataKey="sales" fill="var(--color-sales)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="purchases" fill="var(--color-purchases)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
