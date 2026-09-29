"use client";
import Link from "next/link";
import { ChevronRight, ShoppingBag, ShoppingCart } from "lucide-react";
import { PAYMENT_METHOD_LABELS, type TransactionSummary } from "@shared/contract";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBaht, formatDateTime, formatTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** One clickable row per bill: time, type, who, items, amount (+ income / − expense). */
export function TransactionList({
  items,
  showDate = false,
  className,
}: {
  items: TransactionSummary[];
  /** Show the full date instead of only the time. */
  showDate?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y", className)}>
      {items.map((t) => (
        <li key={t.id}>
          <TransactionRow t={t} showDate={showDate} />
        </li>
      ))}
    </ul>
  );
}

function TransactionRow({ t, showDate }: { t: TransactionSummary; showDate: boolean }) {
  const sale = t.type === "sale";
  const isVoid = t.status === "void";
  const Icon = sale ? ShoppingCart : ShoppingBag;
  const who = t.displayName ?? (sale ? tr("ลูกค้าทั่วไป") : tr("ไม่ระบุผู้ขาย"));
  return (
    <Link
      href={`/transactions/view/?id=${encodeURIComponent(t.id)}`}
      className="group flex items-center gap-3 px-4 py-3 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
    >
      <span className={cn("num w-11 shrink-0 text-sm text-muted-foreground", showDate && "w-auto min-w-11")}>
        {showDate ? formatDateTime(t.occurredAt) : formatTime(t.occurredAt)}
      </span>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          isVoid ? "bg-muted text-muted-foreground" : sale ? "bg-income/12 text-income" : "bg-expense/12 text-expense",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className={cn("min-w-0 flex-1", isVoid && "opacity-60")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{who}</span>
          {isVoid ? (
            <Badge variant="outline" className="text-muted-foreground">
              {tr("ยกเลิก")}
            </Badge>
          ) : t.paymentStatus === "unpaid" ? (
            <Badge variant="outline" className="border-warning/60 bg-warning/15 text-warning-foreground dark:text-warning">
              {tr("ค้างชำระ")}
            </Badge>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="num">{t.docNo}</span>
          {t.itemsPreview ? ` · ${t.itemsPreview}` : ""}
          {t.vehiclePlate ? ` · ${t.vehiclePlate}` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className={cn(
            "num font-semibold",
            isVoid ? "text-muted-foreground line-through" : sale ? "text-income" : "text-expense",
          )}
        >
          {isVoid ? formatBaht(t.total) : `${sale ? "+" : "−"}${formatBaht(t.total)}`}
        </div>
        <div className="text-xs text-muted-foreground">
          {sale ? tr("ขาย") : tr("ซื้อ")} · {PAYMENT_METHOD_LABELS[t.paymentMethod]}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function TransactionListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}
