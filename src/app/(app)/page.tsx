"use client";
import { Greeting } from "@/components/dashboard/greeting";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { LowStockCard, PaymentTodayCard, UnpaidBanner } from "@/components/dashboard/side-cards";
import { DayTransactionsCard } from "@/components/dashboard/today-transactions";
import { TrendCard } from "@/components/dashboard/trend-card";
import { useTodayRanges } from "@/components/dashboard/use-today";
import { useAuth } from "@/lib/auth";

const TREND_DAYS = 14;

export default function DashboardPage() {
  const r = useTodayRanges(TREND_DAYS);
  // Sales totals, profit and the cash drawer only for users who may see the numbers.
  const money = useAuth().can("reports.view");
  return (
    <div className="@container flex flex-col gap-5">
      <Greeting now={r.now} />
      {money ? <UnpaidBanner range={r.allTime} /> : null}
      {money ? <KpiRow today={r.today} yesterday={r.yesterday} /> : null}
      <div className="grid items-start gap-5 @5xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 @5xl:col-span-2">
          <DayTransactionsCard range={r.today} />
          {money ? <TrendCard range={r.trend} days={TREND_DAYS} /> : null}
        </div>
        <div className="grid min-w-0 items-start gap-5 @2xl:grid-cols-2 @5xl:grid-cols-1">
          {money ? <PaymentTodayCard range={r.today} /> : null}
          <LowStockCard />
        </div>
      </div>
    </div>
  );
}
