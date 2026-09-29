"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleCheck, PackageOpen, Wallet } from "lucide-react";
import { formatQty } from "@shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBaht, type Range } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PaymentBreakdown } from "@/components/reports/payment-breakdown";
import { QueryError } from "@/components/reports/query-error";

/** Today's takings by payment method - for reconciling the cash drawer. */
export function PaymentTodayCard({ range }: { range: Range }) {
  const q = useQuery({ queryKey: ["reports", "summary", range], queryFn: () => api.reports.summary(range) });
  return (
    <Card data-shot="payment-today">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="size-[18px] text-muted-foreground" /> {tr("รับเงินวันนี้")}
        </CardTitle>
        <CardDescription>{tr("เงินที่ได้รับจริงวันนี้ แยกตามวิธีชำระ ใช้ตรวจยอดเงินในลิ้นชัก")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <PaymentBreakdown summary={q.data} cashDrawer earlierText={tr("รวมรับชำระบิลค้างที่ออกก่อนวันนี้")} />
        )}
      </CardContent>
    </Card>
  );
}

const LOW_STOCK_SHOWN = 6;

/** Products at or below their alert level. */
export function LowStockCard() {
  const q = useQuery({ queryKey: ["reports", "lowStock", { limit: 200 }], queryFn: () => api.reports.lowStock({ limit: 200 }) });
  const items = q.data ?? [];
  return (
    <Card data-shot="low-stock">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <PackageOpen className="size-[18px] text-muted-foreground" /> {tr("สินค้าใกล้หมด")}
          {items.length > 0 ? (
            <Badge variant="outline" className="num border-warning/60 bg-warning/15 text-warning-foreground dark:text-warning">
              {tr("{0} รายการ", items.length >= 200 ? "200+" : items.length)}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{tr("สต็อกเหลือไม่เกินจำนวนขั้นต่ำที่ตั้งไว้")}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/products/?lowStock=1">
              {tr("ดูสินค้า")} <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-3 text-sm">
            <CircleCheck className="size-5 shrink-0 text-income" />
            <span>{tr("สต็อกเพียงพอทุกรายการ")}</span>
          </div>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {items.slice(0, LOW_STOCK_SHOWN).map((p) => {
              const out = p.stockQty <= 0;
              return (
                <li key={p.id}>
                  <Link
                    href={`/products/view/?id=${encodeURIComponent(p.id)}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[p.spec, p.categoryName].filter(Boolean).join(" · ") || tr("ไม่ระบุหมวดหมู่")}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={cn("num font-semibold", out ? "text-destructive" : "text-foreground")}>
                        {out ? tr("หมด") : tr("เหลือ {0}", formatQty(p.stockQty))}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">{p.unit}</span>
                      </div>
                      <div className="num text-xs text-muted-foreground">{tr("ขั้นต่ำ {0}", formatQty(p.minStock))}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {items.length > LOW_STOCK_SHOWN ? (
              <li className="px-2 pt-1 text-sm text-muted-foreground">{tr("และอีก {0} รายการ", items.length - LOW_STOCK_SHOWN)}</li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Outstanding receivables / payables (all time). Renders nothing when everything is paid. */
export function UnpaidBanner({ range }: { range: Range }) {
  const q = useQuery({ queryKey: ["reports", "summary", range], queryFn: () => api.reports.summary(range) });
  const s = q.data;
  if (!s || (s.sales.unpaidTotal <= 0 && s.purchases.unpaidTotal <= 0)) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm"
      role="status"
      data-shot="unpaid-banner"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/25 text-warning-foreground dark:text-warning">
        <AlertTriangle className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1">
        {s.sales.unpaidTotal > 0 ? (
          <span>
            {tr("ลูกค้าค้างชำระ")} <span className="num font-semibold">{formatBaht(s.sales.unpaidTotal)}</span>{" "}
            <span className="text-muted-foreground">{tr("({0} บิล)", s.sales.unpaidCount)}</span>
          </span>
        ) : null}
        {s.purchases.unpaidTotal > 0 ? (
          <span>
            {tr("ค้างจ่ายผู้ขาย")} <span className="num font-semibold">{formatBaht(s.purchases.unpaidTotal)}</span>{" "}
            <span className="text-muted-foreground">{tr("({0} บิล)", s.purchases.unpaidCount)}</span>
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        {s.sales.unpaidTotal > 0 ? (
          <Button asChild variant="outline" size="sm" className="bg-background/70">
            <Link href="/transactions/?type=sale&paymentStatus=unpaid">{tr("ดูบิลค้างชำระ")}</Link>
          </Button>
        ) : null}
        {s.purchases.unpaidTotal > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/transactions/?type=purchase&paymentStatus=unpaid">{tr("ดูบิลค้างจ่าย")}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
