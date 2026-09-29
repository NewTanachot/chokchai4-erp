"use client";
/** Small building blocks shared by the catalog screens (products, services). */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Product, StockMovementType } from "@shared/contract";
import { STOCK_MOVEMENT_TYPE_LABELS } from "@shared/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/format";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type StockLevel = "untracked" | "negative" | "out" | "low" | "ok";

export function stockLevel(p: Pick<Product, "trackStock" | "stockQty" | "minStock">): StockLevel {
  if (!p.trackStock) return "untracked";
  if (p.stockQty < 0) return "negative";
  if (p.stockQty === 0) return "out";
  if (p.stockQty <= p.minStock) return "low";
  return "ok";
}

const LEVEL_LABEL: Record<StockLevel, string> = {
  untracked: tr("ไม่นับสต็อก"),
  negative: tr("ติดลบ"),
  out: tr("หมด"),
  low: tr("ใกล้หมด"),
  ok: "",
};

/** Small status pill for a stock level (renders nothing for "ok"). */
export function StockLevelBadge({ level, className }: { level: StockLevel; className?: string }) {
  if (level === "ok") return null;
  if (level === "untracked")
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        {LEVEL_LABEL[level]}
      </Badge>
    );
  if (level === "low")
    return <Badge className={cn("bg-warning text-warning-foreground", className)}>{LEVEL_LABEL[level]}</Badge>;
  return (
    <Badge variant="destructive" className={className}>
      {LEVEL_LABEL[level]}
    </Badge>
  );
}

/** "16 เส้น" + status badge, right-aligned, for tables. */
export function StockCell({ product }: { product: Pick<Product, "trackStock" | "stockQty" | "minStock" | "unit"> }) {
  const level = stockLevel(product);
  if (level === "untracked") return <span className="text-sm text-muted-foreground">{tr("ไม่นับสต็อก")}</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <StockLevelBadge level={level} />
      <span className={cn("num font-medium", (level === "negative" || level === "out") && "text-destructive")}>
        {formatQty(product.stockQty)}
      </span>
      <span className="w-12 text-left text-xs text-muted-foreground">{product.unit}</span>
    </span>
  );
}

const MOVEMENT_CLASS: Record<StockMovementType, string> = {
  initial: "bg-secondary text-secondary-foreground",
  purchase: "bg-income/12 text-income dark:bg-income/18",
  sale: "bg-primary/10 text-primary dark:bg-primary/18",
  adjust: "bg-warning/25 text-foreground dark:bg-warning/20",
};

export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  return <Badge className={cn("min-w-16", MOVEMENT_CLASS[type])}>{STOCK_MOVEMENT_TYPE_LABELS[type]}</Badge>;
}

/** Signed quantity, e.g. "+4" (green) / "−2" (red). */
export function SignedQty({ qty, className }: { qty: number; className?: string }) {
  return (
    <span className={cn("num font-medium", qty > 0 ? "text-income" : qty < 0 ? "text-expense" : "", className)}>
      {qty > 0 ? "+" : qty < 0 ? "−" : ""}
      {formatQty(Math.abs(qty))}
    </span>
  );
}

/** Profit per unit and gross margin (% of the selling price). */
export function marginOf(costPrice: number, sellPrice: number): { profit: number; percent: number | null } {
  const profit = sellPrice - costPrice;
  return { profit, percent: sellPrice > 0 ? (profit / sellPrice) * 100 : null };
}

export const formatPercent = (n: number) => `${n.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%`;

/** "แสดง 1–20 จาก 45 รายการ" + previous / next buttons. */
export function Pager({
  offset,
  limit,
  total,
  onChange,
  className,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  className?: string;
}) {
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className={cn("flex items-center justify-between gap-3 text-sm text-muted-foreground", className)}>
      <span>
        {tr("แสดง")} <span className="num text-foreground">{from.toLocaleString(LOCALE)}</span>–
        <span className="num text-foreground">{to.toLocaleString(LOCALE)}</span> {tr("จาก ")}
        <span className="num text-foreground">{total.toLocaleString(LOCALE)}</span> {trc("unit", "รายการ")}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="lg" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          <ChevronLeft /> {tr("ก่อนหน้า")}
        </Button>
        <span className="num min-w-14 text-center">
          {page} / {pages}
        </span>
        <Button variant="outline" size="lg" disabled={to >= total} onClick={() => onChange(offset + limit)}>
          {tr("ถัดไป")} <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Rounded filter chip with an optional count, used for category filters. */
export function FilterChip({
  active,
  onClick,
  children,
  count,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50",
        className,
      )}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            "num min-w-5 rounded-full px-1.5 text-xs leading-5",
            active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {count.toLocaleString(LOCALE)}
        </span>
      ) : null}
    </button>
  );
}
