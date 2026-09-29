"use client";
import { Banknote, CircleEllipsis, Clock, CreditCard, HandCoins, Landmark, type LucideIcon } from "lucide-react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod, type Summary } from "@shared/contract";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { formatPercent, PAYMENT_ORDER } from "./format";
import { MeterList, type MeterRow } from "./meter-list";

export const PAYMENT_ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  transfer: Landmark,
  card: CreditCard,
  credit: HandCoins,
  other: CircleEllipsis,
};

/** Always listed, even at ฿0 (credit / other only when money was actually recorded under them). */
const ALWAYS_SHOWN: PaymentMethod[] = ["cash", "transfer", "card"];

/**
 * Money actually received in the range (bills PAID in the range, by paidAt - so credit collected today counts
 * today), by payment method, then the range's sales that are still unpaid. With `cashDrawer`, a box for
 * reconciling the cash drawer: cash received - cash paid for purchases.
 * @param earlierText the note about older unpaid bills collected in the range, e.g. "รวมรับชำระบิลค้างที่ออกก่อนวันนี้"
 */
export function PaymentBreakdown({
  summary,
  cashDrawer = false,
  earlierText = tr("รวมรับชำระบิลค้างที่ออกก่อนช่วงนี้"),
}: {
  summary: Summary;
  cashDrawer?: boolean;
  earlierText?: string;
}) {
  const by = new Map(summary.salesReceivedByPaymentMethod.map((r) => [r.method, r]));
  const methods = PAYMENT_ORDER.filter((m) => ALWAYS_SHOWN.includes(m) || by.has(m));
  const unpaid = summary.sales.unpaidTotal;
  const base = summary.salesReceivedByPaymentMethod.reduce((s, r) => s + r.total, 0) + unpaid;
  const share = (amount: number) => (base > 0 ? amount / base : 0);

  const rows: MeterRow[] = methods.map((m) => {
    const r = by.get(m);
    const amount = r?.total ?? 0;
    return {
      key: m,
      icon: PAYMENT_ICONS[m],
      label: PAYMENT_METHOD_LABELS[m],
      sub: r ? tr("{0} บิล", r.count) : tr("ยังไม่มี"),
      value: formatBaht(amount),
      valueSub: base > 0 ? formatPercent(share(amount)) : undefined,
      ratio: share(amount),
      muted: amount === 0,
    };
  });
  rows.push({
    key: "unpaid",
    icon: Clock,
    label: tr("ค้างชำระ"),
    sub: summary.sales.unpaidCount > 0 ? tr("{0} บิล · ยังไม่ได้รับเงิน", summary.sales.unpaidCount) : tr("ไม่มีบิลค้างชำระ"),
    value: formatBaht(unpaid),
    valueSub: base > 0 ? formatPercent(share(unpaid)) : undefined,
    ratio: share(unpaid),
    muted: unpaid === 0,
  });

  const earlier = summary.salesCollectedEarlier;
  const cashIn = by.get("cash")?.total ?? 0;
  const cashOut = summary.purchasesPaidByPaymentMethod.find((r) => r.method === "cash")?.total ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <MeterList rows={rows} color="var(--chart-2)" />
      {earlier.count > 0 ? (
        <p className="text-xs text-muted-foreground" data-shot="collected-earlier">
          {earlierText} <span className="num font-medium text-foreground">{formatBaht(earlier.total)}</span> {tr("({0} บิล)", earlier.count)}
        </p>
      ) : null}
      {cashDrawer ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" data-shot="cash-drawer">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{tr("รับเงินสดจากการขาย")}</span>
            <span className="num">{formatBaht(cashIn)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{tr("จ่ายค่าซื้อเป็นเงินสด")}</span>
            <span className="num">{cashOut > 0 ? `−${formatBaht(cashOut)}` : formatBaht(0)}</span>
          </div>
          <div className="mt-1.5 flex justify-between gap-3 border-t pt-1.5 font-semibold">
            <span>{tr("เงินสดสุทธิวันนี้")}</span>
            <span className="num">{formatBaht(cashIn - cashOut)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
