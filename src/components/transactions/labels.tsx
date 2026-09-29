"use client";
/** Badges and small display helpers shared by the transaction screens. */
import { Ban, CircleCheck, Clock3 } from "lucide-react";
import type { PaymentMethod, PaymentStatus, TransactionStatus, TransactionType } from "@shared/contract";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from "@shared/contract";
import { Badge } from "@/components/ui/badge";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const TYPE_TITLES: Record<TransactionType, string> = {
  sale: tr("ขายสินค้า / บริการ"),
  purchase: tr("บันทึกการซื้อ"),
};

/** Colour of a bill amount: sales are income, purchases are expense. */
export const amountTone = (type: TransactionType) => (type === "sale" ? "text-income" : "text-expense");

export function TypeBadge({ type, className }: { type: TransactionType; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 rounded-md px-2 text-[13px] font-medium",
        type === "sale" ? "border-income/30 bg-income/10 text-income" : "border-chart-5/30 bg-chart-5/10 text-chart-5",
        className,
      )}
    >
      {TRANSACTION_TYPE_LABELS[type]}
    </Badge>
  );
}

export function PaymentBadge({
  status,
  method,
  className,
}: {
  status: PaymentStatus;
  method?: PaymentMethod;
  className?: string;
}) {
  const paid = status === "paid";
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 gap-1 rounded-md px-2 text-[13px] font-medium",
        paid
          ? "border-success/30 bg-success/10 text-success"
          : "border-warning/50 bg-warning/15 text-warning-foreground dark:text-warning",
        className,
      )}
    >
      {paid ? <CircleCheck /> : <Clock3 />}
      {PAYMENT_STATUS_LABELS[status]}
      {method ? <span className="font-normal opacity-80">· {PAYMENT_METHOD_LABELS[method]}</span> : null}
    </Badge>
  );
}

export function VoidBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-6 gap-1 rounded-md border-destructive/30 bg-destructive/10 px-2 text-[13px] text-destructive", className)}>
      <Ban /> {tr("ยกเลิกแล้ว")}
    </Badge>
  );
}

export function StatusBadges({ status, paymentStatus, method }: { status: TransactionStatus; paymentStatus: PaymentStatus; method?: PaymentMethod }) {
  if (status === "void") return <VoidBadge />;
  return <PaymentBadge status={paymentStatus} method={method} />;
}

/** Where to go for each screen (static export: query params, trailing slash before "?"). */
export const txHref = {
  list: (params?: Record<string, string>) => `/transactions/${params && Object.keys(params).length ? "?" + new URLSearchParams(params) : ""}`,
  view: (id: string, extra?: Record<string, string>) => `/transactions/view/?${new URLSearchParams({ id, ...extra })}`,
  edit: (id: string) => `/transactions/edit/?id=${encodeURIComponent(id)}`,
  new: (type: TransactionType, extra?: Record<string, string>) => `/transactions/new/?${new URLSearchParams({ type, ...extra })}`,
};
