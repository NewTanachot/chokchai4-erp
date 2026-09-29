"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PRICE_SOURCE_LABELS, type PriceChange } from "@shared/contract";
import { Pager } from "@/components/catalog/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { formatBaht, formatDate, formatTime } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PAGE = 10;

function Delta({ c }: { c: PriceChange }) {
  if (c.oldValue === null) return null;
  const diff = c.newValue - c.oldValue;
  if (!diff) return null;
  const up = diff > 0;
  const pct = c.oldValue > 0 ? Math.abs(diff / c.oldValue) * 100 : null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs", c.field === "sell" ? (up ? "text-income" : "text-expense") : up ? "text-expense" : "text-income")}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {up ? "+" : "−"}
      {formatBaht(Math.abs(diff))}
      {pct !== null ? ` (${pct.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%)` : ""}
    </span>
  );
}

/** Price changes of a product or service, newest first: when, which price, old -> new, why, who. */
export function PriceHistoryTable({ itemType, id, showField = true }: { itemType: "product" | "service"; id: string; showField?: boolean }) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: [itemType === "product" ? "products" : "serviceItems", "priceHistory", id, offset],
    queryFn: () => (itemType === "product" ? api.products.priceHistory({ id, limit: PAGE, offset }) : api.serviceItems.priceHistory({ id, limit: PAGE, offset })),
    placeholderData: keepPreviousData,
  });
  const items = q.data?.items ?? [];

  if (q.isPending) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-6" />
        ))}
      </div>
    );
  }
  if (q.isError) return <p className="p-6 text-center text-sm text-destructive">{errorMessage(q.error)}</p>;
  if (!items.length) return <p className="p-6 text-center text-sm text-muted-foreground">{tr("ยังไม่มีการเปลี่ยนราคา")}</p>;

  return (
    <>
      <Table className={cn(q.isPlaceholderData && "opacity-60")} data-shot="price-history">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-4">{tr("วันที่ เวลา")}</TableHead>
            {showField ? <TableHead>{tr("ราคา")}</TableHead> : null}
            <TableHead className="text-right">{tr("เปลี่ยนจาก → เป็น")}</TableHead>
            <TableHead>{tr("สาเหตุ")}</TableHead>
            <TableHead className="pr-4">{tr("ผู้แก้ไข")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="pl-4">
                <div className="num">{formatDate(c.at)}</div>
                <div className="num text-xs text-muted-foreground">{tr("{0} น.", formatTime(c.at))}</div>
              </TableCell>
              {showField ? (
                <TableCell>
                  <Badge variant={c.field === "sell" ? "secondary" : "outline"}>{c.field === "sell" ? (itemType === "service" ? tr("ราคาตั้งต้น") : tr("ราคาขาย")) : tr("ราคาทุน")}</Badge>
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                <div className="num whitespace-nowrap">
                  {c.oldValue !== null ? (
                    <>
                      <span className="text-muted-foreground">{formatBaht(c.oldValue)}</span>
                      <ArrowRight className="mx-1 inline size-3.5 text-muted-foreground" />
                    </>
                  ) : null}
                  <span className="font-semibold">{formatBaht(c.newValue)}</span>
                </div>
                <Delta c={c} />
              </TableCell>
              <TableCell className="max-w-64">
                <div>
                  {PRICE_SOURCE_LABELS[c.source]}
                  {c.transactionId && c.docNo ? (
                    <>
                      {" "}
                      <Link href={`/transactions/view/?id=${encodeURIComponent(c.transactionId)}`} className="num font-medium text-primary hover:underline">
                        {c.docNo}
                      </Link>
                    </>
                  ) : null}
                </div>
                {c.note ? <div className="text-xs text-muted-foreground">{tr(c.note)}</div> : null}
              </TableCell>
              <TableCell className="pr-4">{c.userName ?? <span className="text-muted-foreground">{tr("ระบบ")}</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager className="border-t px-4 py-3" offset={offset} limit={PAGE} total={q.data?.total ?? 0} onChange={setOffset} />
    </>
  );
}
