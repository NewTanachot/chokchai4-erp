"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Scale } from "lucide-react";
import { api } from "@/lib/api";
import { formatBaht, type Range } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/components/reports/format";
import { QueryError } from "@/components/reports/query-error";
import { Delta, StatCard } from "@/components/reports/stat-card";
import { Card } from "@/components/ui/card";

/** Today's four headline numbers, each compared with yesterday. */
export function KpiRow({ today, yesterday }: { today: Range; yesterday: Range }) {
  const cur = useQuery({ queryKey: ["reports", "summary", today], queryFn: () => api.reports.summary(today) });
  const prev = useQuery({ queryKey: ["reports", "summary", yesterday], queryFn: () => api.reports.summary(yesterday) });

  if (cur.error || prev.error) {
    return (
      <Card className="py-0">
        <QueryError error={cur.error ?? prev.error} onRetry={() => void Promise.all([cur.refetch(), prev.refetch()])} />
      </Card>
    );
  }
  const loading = !cur.data || !prev.data;
  const c = cur.data;
  const p = prev.data;
  const beforeVat = c ? c.sales.total - c.sales.vatAmount : 0;
  const margin = c && beforeVat > 0 ? c.grossProfit / beforeVat : null;

  return (
    <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @2xl:grid-cols-4 @5xl:gap-4">
      <StatCard
        label={tr("รายรับวันนี้")}
        icon={ArrowDownLeft}
        tone="income"
        loading={loading}
        value={c ? formatBaht(c.sales.total) : null}
        valueClassName="text-income"
        sub={c ? tr("ขาย {0} บิล", c.sales.count) : null}
        delta={c && p ? <Delta current={c.sales.total} previous={p.sales.total} /> : null}
        data-shot="kpi-sales"
      />
      <StatCard
        label={tr("รายจ่ายวันนี้")}
        icon={ArrowUpRight}
        tone="expense"
        loading={loading}
        value={c ? formatBaht(c.purchases.total) : null}
        valueClassName="text-expense"
        sub={c ? tr("ซื้อเข้า {0} บิล", c.purchases.count) : null}
        delta={c && p ? <Delta current={c.purchases.total} previous={p.purchases.total} upIsGood={false} /> : null}
      />
      <StatCard
        label={tr("สุทธิวันนี้")}
        icon={Scale}
        tone="primary"
        loading={loading}
        value={c ? formatBaht(c.net) : null}
        valueClassName={cn(c && c.net < 0 && "text-expense")}
        sub={tr("รายรับ − รายจ่าย")}
        delta={c && p ? <Delta current={c.net} previous={p.net} /> : null}
      />
      <StatCard
        label={tr("กำไรขั้นต้นวันนี้")}
        icon={PiggyBank}
        tone="primary"
        loading={loading}
        value={c ? formatBaht(c.grossProfit) : null}
        valueClassName={cn(c && c.grossProfit < 0 && "text-expense")}
        sub={margin !== null ? tr("อัตรากำไร {0}", formatPercent(margin)) : tr("ยอดขาย − ต้นทุนสินค้า")}
        delta={c && p ? <Delta current={c.grossProfit} previous={p.grossProfit} /> : null}
      />
    </div>
  );
}
