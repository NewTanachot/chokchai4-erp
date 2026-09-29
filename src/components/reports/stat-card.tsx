"use client";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatPercent } from "./format";

export type Tone = "income" | "expense" | "primary" | "warning" | "neutral";

const TONE_BUBBLE: Record<Tone, string> = {
  income: "bg-income/12 text-income",
  expense: "bg-expense/12 text-expense",
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/20 text-warning-foreground dark:text-warning",
  neutral: "bg-muted text-muted-foreground",
};

/** KPI tile: label + icon, big value, a secondary line and an optional comparison. */
export function StatCard({
  label,
  icon: Icon,
  tone = "neutral",
  value,
  valueClassName,
  sub,
  delta,
  loading,
  className,
  "data-shot": dataShot,
}: {
  label: string;
  icon: LucideIcon;
  tone?: Tone;
  value: React.ReactNode;
  valueClassName?: string;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  loading?: boolean;
  className?: string;
  "data-shot"?: string;
}) {
  return (
    // Narrow tiles (4 across at 1024 px) drop the icon and use a slightly smaller figure.
    <Card className={cn("@container/stat gap-0 py-4", className)} data-shot={dataShot}>
      <CardContent className="flex h-full flex-col px-3.5 @[13rem]/stat:px-4">
        <div className="flex min-h-7 items-start justify-between gap-3">
          <span className="pt-1 text-sm font-medium text-muted-foreground">{label}</span>
          <span className={cn("hidden size-9 shrink-0 items-center justify-center rounded-lg @[13rem]/stat:flex", TONE_BUBBLE[tone])}>
            <Icon className="size-[18px]" />
          </span>
        </div>
        {loading ? (
          <div className="mt-1 space-y-2">
            <Skeleton className="h-8 w-full max-w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
        ) : (
          <>
            <div
              className={cn(
                "num mt-1 text-[1.3125rem] leading-tight font-semibold tracking-tight @[13rem]/stat:mt-0.5 @[13rem]/stat:text-[1.625rem]",
                valueClassName,
              )}
            >
              {value}
            </div>
            {sub ? <div className="mt-1 text-sm text-muted-foreground">{sub}</div> : null}
            {delta ? <div className="mt-auto pt-3">{delta}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "▲ 12.5%  เมื่อวาน ฿10,500.00" - percentage when the base is positive, else the change in baht.
 * `upIsGood` decides the colour (expenses going up is not "good"). No pill when there is nothing to compare with.
 */
export function Delta({
  current,
  previous,
  upIsGood = true,
  label = tr("เมื่อวาน"),
}: {
  current: number;
  previous: number;
  upIsGood?: boolean;
  label?: string;
}) {
  const diff = current - previous;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const good = dir === "flat" ? null : (dir === "up") === upIsGood;
  // Percentages only make sense from a positive base to a non-negative value; otherwise show the change in baht.
  const amount = previous > 0 && current >= 0 ? formatPercent(Math.abs(diff) / previous) : formatBaht(Math.abs(diff));
  const tone = good === null ? "bg-muted text-muted-foreground" : good ? "bg-income/12 text-income" : "bg-expense/12 text-expense";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {previous === 0 ? null : (
        <span className={cn("num inline-flex items-center rounded-md px-1.5 py-0.5 font-medium", tone)}>
          {dir === "flat" ? tr("เท่าเดิม") : `${dir === "up" ? "▲" : "▼"} ${amount}`}
        </span>
      )}
      <span className="text-muted-foreground">
        {label} <span className="num">{formatBaht(previous)}</span>
      </span>
    </div>
  );
}
