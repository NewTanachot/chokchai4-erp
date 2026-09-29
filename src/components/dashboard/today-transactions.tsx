"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronUp, ReceiptText, ShoppingBag, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { api } from "@/lib/api";
import type { Range } from "@/lib/format";
import { QueryError } from "@/components/reports/query-error";
import { TransactionList, TransactionListSkeleton } from "@/components/reports/transaction-list";
import { tr } from "@/lib/i18n";

/** Link to the transactions list filtered to a range (epoch ms, [from, to)). */
export const transactionsHref = (r: Range, extra = "") => `/transactions/?from=${r.from}&to=${r.to}${extra}`;

/** Every bill of the range (newest first). Used for "รายการวันนี้" and single-day reports. */
export function DayTransactionsCard({
  range,
  title = tr("รายการวันนี้"),
  emptyTitle = tr("วันนี้ยังไม่มีรายการ"),
  emptyHint = tr("เมื่อขายหรือบันทึกการซื้อ รายการจะแสดงที่นี่ทันที"),
  collapsedRows = 8,
}: {
  range: Range;
  title?: string;
  emptyTitle?: string;
  emptyHint?: string;
  /** Rows shown before "แสดงทั้งหมด" on busy days. */
  collapsedRows?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const q = useQuery({
    queryKey: ["reports", "recent", { ...range, limit: 500 }],
    queryFn: () => api.reports.recent({ from: range.from, to: range.to, limit: 500 }),
  });
  const items = q.data ?? [];
  const sales = items.filter((t) => t.type === "sale" && t.status === "completed").length;
  const purchases = items.filter((t) => t.type === "purchase" && t.status === "completed").length;
  const voids = items.filter((t) => t.status === "void").length;

  return (
    <Card className="gap-0 pb-0" data-shot="today-transactions">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ReceiptText className="size-[18px] text-muted-foreground" /> {title}
        </CardTitle>
        <CardDescription>
          {q.data ? (
            items.length > 0 ? (
              <>
                {tr("ขาย {0} บิล · ซื้อ {1} บิล{2}", sales, purchases, voids > 0 ? tr(" · ยกเลิก {0} บิล", voids) : "")}
              </>
            ) : (
              tr("ยังไม่มีบิล")
            )
          ) : (
            tr("กำลังโหลด…")
          )}
        </CardDescription>
        {items.length > 0 ? (
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href={transactionsHref(range)}>
                {tr("ดูทั้งหมด")} <ArrowRight />
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <TransactionListSkeleton />
        ) : items.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-11 rounded-full bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-5">
                <ReceiptText />
              </EmptyMedia>
              <EmptyTitle className="text-base">{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyHint}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button asChild size="lg" className="px-4">
                <Link href="/transactions/new/?type=sale" data-shot="empty-new-sale">
                  <ShoppingCart /> {tr("ขายสินค้า / บริการ")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="px-3.5">
                <Link href="/transactions/new/?type=purchase">
                  <ShoppingBag /> {tr("บันทึกการซื้อ")}
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <TransactionList items={expanded ? items : items.slice(0, collapsedRows)} />
            {items.length > collapsedRows ? (
              <div className="border-t px-4 py-2 text-center">
                <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} data-shot="today-expand">
                  {expanded ? (
                    <>
                      <ChevronUp /> {tr("แสดงน้อยลง")}
                    </>
                  ) : (
                    <>
                      <ChevronDown /> {tr("แสดงอีก {0} รายการ", items.length - collapsedRows)}
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
