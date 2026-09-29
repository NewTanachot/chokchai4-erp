"use client";
/** Segmented controls for payment method / status / VAT mode. */
import { Banknote, CircleCheck, Clock3, CreditCard, HandCoins, Smartphone } from "lucide-react";
import type { VatMode } from "@shared/calc";
import type { PaymentMethod, PaymentStatus } from "@shared/contract";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  layout = "inline",
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  className?: string;
  size?: "sm" | "md";
  /** "stacked": icon above the label (bigger targets, fits 4 options in a narrow panel). */
  layout?: "inline" | "stacked";
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("grid gap-1 rounded-lg bg-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-w-0 items-center justify-center rounded-md px-1.5 font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              layout === "stacked" ? "h-[3.25rem] flex-col gap-0.5 text-[13px]" : cn("gap-1.5", size === "md" ? "h-9 text-sm" : "h-8 text-[13px]"),
              active ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/10 dark:bg-input/60" : "text-muted-foreground hover:text-foreground",
            )}
            data-shot={`opt-${o.value}`}
          >
            {Icon ? <Icon className={cn("shrink-0", layout === "stacked" ? "size-5" : "size-4", active && "text-primary")} /> : null}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export const METHOD_OPTIONS: Option<PaymentMethod>[] = [
  { value: "cash", label: tr("เงินสด"), icon: Banknote },
  { value: "transfer", label: tr("โอนเงิน"), icon: Smartphone },
  { value: "card", label: tr("บัตร"), icon: CreditCard },
  { value: "credit", label: tr("เครดิต"), icon: HandCoins },
];

export const STATUS_OPTIONS: Option<PaymentStatus>[] = [
  { value: "paid", label: tr("ชำระแล้ว"), icon: CircleCheck },
  { value: "unpaid", label: tr("ค้างชำระ"), icon: Clock3 },
];

export const vatOptions = (rate: number): Option<VatMode>[] => [
  { value: "none", label: tr("ไม่มี VAT") },
  { value: "inclusive", label: tr("รวม VAT {0}%", rate) },
  { value: "exclusive", label: tr("แยก VAT {0}%", rate) },
];
