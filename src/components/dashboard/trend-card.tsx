"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChartColumn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBaht, formatDateLong, type Range } from "@/lib/format";
import { formatDayShort } from "@/components/reports/format";
import { QueryError } from "@/components/reports/query-error";
import { dateKeyToMs } from "@/components/reports/ranges";
import { SalesPurchaseChart, type ChartPoint } from "@/components/reports/sales-purchase-chart";
import { tr } from "@/lib/i18n";

/** Last-N-days columns: sales vs purchases. */
export function TrendCard({ range, days }: { range: Range; days: number }) {
  const q = useQuery({ queryKey: ["reports", "daily", range], queryFn: () => api.reports.daily(range) });
  const rows = q.data ?? [];
  const last = rows.length - 1;
  const data: ChartPoint[] = rows.map((r, i) => {
    const ms = dateKeyToMs(r.date);
    return {
      key: r.date,
      label: i === last ? tr("วันนี้") : formatDayShort(ms),
      title: formatDateLong(ms),
      sales: r.salesTotal,
      purchases: r.purchasesTotal,
    };
  });
  const sales = rows.reduce((s, r) => s + r.salesTotal, 0);
  const purchases = rows.reduce((s, r) => s + r.purchasesTotal, 0);

  return (
    <Card className="gap-3" data-shot="trend-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ChartColumn className="size-[18px] text-muted-foreground" /> {tr("ขาย-ซื้อ {0} วันล่าสุด", days)}
        </CardTitle>
        <CardDescription>
          {q.data ? (
            <>
              {tr("ขายรวม")} <span className="num font-medium text-foreground">{formatBaht(sales)}</span> {tr("· ซื้อรวม ")}
              <span className="num font-medium text-foreground">{formatBaht(purchases)}</span>
            </>
          ) : (
            tr("กำลังโหลด…")
          )}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/reports/?range=30d">
              {tr("ดูรายงาน")} <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <SalesPurchaseChart data={data} />
        )}
      </CardContent>
    </Card>
  );
}
