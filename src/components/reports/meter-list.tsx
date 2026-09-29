"use client";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MeterRow {
  key: string;
  label: React.ReactNode;
  /** Shown under the label (muted). */
  sub?: React.ReactNode;
  /** Right-aligned value text. */
  value: React.ReactNode;
  /** Right-aligned secondary text under the value (muted). */
  valueSub?: React.ReactNode;
  /** 0..1 fill of the meter. */
  ratio: number;
  icon?: LucideIcon;
  rank?: number;
  muted?: boolean;
}

/**
 * Ranked rows with a thin single-hue meter (share of the largest / of the total).
 * One colour for every row: the bar length carries the magnitude, the text carries the value.
 */
export function MeterList({
  rows,
  color = "var(--chart-1)",
  className,
}: {
  rows: MeterRow[];
  /** CSS colour of the meter fill (a theme token). */
  color?: string;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-3.5", className)}>
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <li key={r.key} className={cn("flex items-start gap-3", r.muted && "opacity-60")}>
            {r.rank !== undefined ? (
              <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                {r.rank}
              </span>
            ) : Icon ? (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.label}</div>
                  {r.sub ? <div className="truncate text-xs text-muted-foreground">{r.sub}</div> : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="num font-semibold">{r.value}</div>
                  {r.valueSub ? <div className="num text-xs text-muted-foreground">{r.valueSub}</div> : null}
                </div>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max(0, Math.min(1, r.ratio)) * 100}%`, background: color, minWidth: r.ratio > 0 ? 4 : 0 }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
