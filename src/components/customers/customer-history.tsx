"use client";
/**
 * Timeline of a customer's bills: answers "has this customer been here, what was done, when".
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Ban, Car, ChevronRight, Gauge, History, Package, ReceiptText, RotateCcw, ShoppingCart, StickyNote, Tag, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PAYMENT_METHOD_LABELS, type LineItemType, type TransactionDetail } from "@shared/contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { LOCALE, tr } from "@/lib/i18n";
import { fetchFirst } from "@/lib/paging";
import { formatBaht, formatDate, formatDateTime, formatQty, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatMonthYear, monthKey, newSaleHref, relativeTime, transactionViewHref } from "./customer-utils";

const PAGE = 20;

const ITEM_ICON: Record<LineItemType, { icon: typeof Wrench; className: string; label: string }> = {
  service: { icon: Wrench, className: "bg-primary/12 text-primary", label: tr("บริการ") },
  product: { icon: Package, className: "bg-chart-4/15 text-chart-4", label: tr("สินค้า") },
  custom: { icon: Tag, className: "bg-muted text-muted-foreground", label: tr("อื่น ๆ") },
};

function ItemTypeIcon({ type, className }: { type: LineItemType; className?: string }) {
  const t = ITEM_ICON[type];
  const Icon = t.icon;
  return (
    <span title={t.label} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", t.className, className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

function PaymentBadges({ t }: { t: TransactionDetail }) {
  if (t.status === "void") {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-destructive/10 px-2 text-xs font-medium text-destructive">
        <Ban className="size-3.5" /> {tr("ยกเลิกแล้ว")}
      </span>
    );
  }
  return (
    <>
      <span
        className={cn(
          "inline-flex h-6 items-center rounded-full px-2 text-xs font-medium",
          t.paymentStatus === "unpaid" ? "bg-expense/10 text-expense" : "bg-income/10 text-income",
        )}
      >
        {t.paymentStatus === "unpaid" ? tr("ค้างชำระ") : tr("ชำระแล้ว")}
      </span>
      <span className="inline-flex h-6 items-center rounded-full border px-2 text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[t.paymentMethod]}</span>
    </>
  );
}

function BillCard({ t }: { t: TransactionDetail }) {
  const isVoid = t.status === "void";
  const href = transactionViewHref(t.id);
  const hasVehicle = t.vehiclePlate || t.vehicleModel || t.mileage != null;
  const serviceCount = t.items.filter((i) => i.itemType === "service").length;
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border bg-card shadow-xs transition-colors",
        isVoid ? "border-dashed bg-muted/30" : "hover:border-foreground/20",
      )}
      data-shot="history-bill"
    >
      {/* header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-4 pt-3 pb-2.5">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className={cn("inline-flex items-center gap-1.5 font-semibold text-primary hover:underline hover:underline-offset-3", isVoid && "text-muted-foreground line-through")}
            >
              <ReceiptText className="size-4" />
              <span className="num">{t.docNo}</span>
            </Link>
            {t.type === "purchase" ? <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2 text-xs">{tr("บิลซื้อ")}</span> : null}
            <PaymentBadges t={t} />
          </div>
          {hasVehicle ? (
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", isVoid ? "text-muted-foreground" : "text-foreground/85")}>
              {t.vehiclePlate ? (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Car className="size-4 text-muted-foreground" />
                  {t.vehiclePlate}
                </span>
              ) : null}
              {t.vehicleModel ? <span className="text-muted-foreground">{t.vehicleModel}</span> : null}
              {t.mileage != null ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Gauge className="size-3.5" />
                  <span className="num">{t.mileage.toLocaleString(LOCALE)}</span> {tr("กม.")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <div className={cn("num text-lg leading-tight font-semibold", isVoid && "text-muted-foreground line-through")}>{formatBaht(t.total)}</div>
          <div className="text-xs text-muted-foreground">
            {tr("{0} รายการ{1}", t.items.length, serviceCount ? tr(" · บริการ {0}", serviceCount) : "")}
          </div>
        </div>
      </div>

      {/* items */}
      <ul className={cn("divide-y divide-dashed border-t px-4", isVoid && "opacity-70")}>
        {t.items.map((it) => (
          <li key={it.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 py-2">
            <ItemTypeIcon type={it.itemType} className="mt-px" />
            <div className="min-w-0">
              <div className={cn("text-sm leading-snug", it.itemType === "service" && "font-medium")}>{it.name}</div>
              <div className="num text-xs text-muted-foreground">
                {formatQty(it.qty)} {it.unit ?? ""} × {formatBaht(it.unitPrice)}
                {it.discount > 0 ? <span className="text-expense"> {tr("· ลด {0}", formatBaht(it.discount))}</span> : null}
                {it.note ? <span> · {it.note}</span> : null}
              </div>
            </div>
            <div className="num pt-px text-right text-sm">{formatBaht(it.total)}</div>
          </li>
        ))}
      </ul>

      {/* footer: bill-level adjustments, note, void reason */}
      {t.discount > 0 || t.vatAmount > 0 || t.note || isVoid ? (
        <div className="space-y-1.5 border-t bg-muted/30 px-4 py-2.5 text-sm">
          {t.discount > 0 ? (
            <div className="flex justify-between text-muted-foreground">
              <span>{tr("ส่วนลดท้ายบิล")}</span>
              <span className="num text-expense">−{formatBaht(t.discount)}</span>
            </div>
          ) : null}
          {t.vatAmount > 0 ? (
            <div className="flex justify-between text-muted-foreground">
              <span>
                VAT {t.vatRate}% {t.vatMode === "inclusive" ? tr("(รวมในราคาแล้ว)") : ""}
              </span>
              <span className="num">{formatBaht(t.vatAmount)}</span>
            </div>
          ) : null}
          {t.note ? (
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <StickyNote className="mt-1 size-3.5 shrink-0" />
              <span className="whitespace-pre-line">{t.note}</span>
            </div>
          ) : null}
          {isVoid ? (
            <div className="flex items-start gap-1.5 text-destructive">
              <Ban className="mt-1 size-3.5 shrink-0" />
              <span>
                {tr("ยกเลิกบิล{0}{1}", t.voidedAt ? tr("เมื่อ {0} น.", formatDateTime(t.voidedAt)) : "", t.voidReason ? tr(" · เหตุผล: {0}", t.voidReason) : "")}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TimelineEntry({ t, first, last }: { t: TransactionDetail; first: boolean; last: boolean }) {
  const isVoid = t.status === "void";
  const dot = isVoid ? "bg-muted-foreground/50" : t.paymentStatus === "unpaid" ? "bg-expense" : "bg-primary";
  return (
    <li className="grid grid-cols-[5.75rem_1.5rem_minmax(0,1fr)] gap-x-2 @xl:grid-cols-[7rem_1.5rem_minmax(0,1fr)]">
      {/* when */}
      <div className={cn("pt-3 text-right", isVoid && "opacity-60")}>
        <div className="text-sm leading-tight font-medium">{formatDate(t.occurredAt)}</div>
        <div className="num mt-0.5 text-xs text-muted-foreground">{tr("{0} น.", formatTime(t.occurredAt))}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{relativeTime(t.occurredAt)}</div>
      </div>
      {/* rail */}
      <div className="relative flex justify-center">
        {!(first && last) ? (
          <span className="absolute w-px bg-border" style={{ top: first ? "1.375rem" : 0, bottom: last ? "calc(100% - 1.375rem)" : 0 }} aria-hidden />
        ) : null}
        <span className={cn("relative z-10 mt-4 size-3 rounded-full ring-4 ring-card", dot)} aria-hidden />
      </div>
      {/* what */}
      <div className="min-w-0 pb-4">
        <BillCard t={t} />
      </div>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="grid grid-cols-[5.75rem_1.5rem_minmax(0,1fr)] gap-x-2 @xl:grid-cols-[7rem_1.5rem_minmax(0,1fr)]">
          <div className="space-y-1.5 pt-3">
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="ml-auto h-3 w-12" />
          </div>
          <div className="flex justify-center pt-4">
            <Skeleton className="size-3 rounded-full" />
          </div>
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function CustomerHistory({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [includeVoid, setIncludeVoid] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [includeVoid, customerId]);

  const query = { customerId, includeVoid, limit, offset: 0 };
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["customers", "history", query],
    queryFn: () => fetchFirst(limit, (limit, offset) => api.customers.history({ ...query, limit, offset })),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Group by month for easier scanning.
  const groups: { key: string; label: string; items: TransactionDetail[] }[] = [];
  for (const t of items) {
    const key = monthKey(t.occurredAt);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(t);
    else groups.push({ key, label: formatMonthYear(t.occurredAt), items: [t] });
  }

  return (
    <Card className="@container gap-0 pb-0" data-shot="customer-history">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4.5 text-muted-foreground" /> {tr("ประวัติการใช้บริการ")}
        </CardTitle>
        <CardDescription>
          {data ? (total > 0 ? tr("{0} บิล · ล่าสุดอยู่บนสุด", total.toLocaleString(LOCALE)) : tr("ยังไม่มีบิล")) : tr("กำลังโหลด…")}
        </CardDescription>
        <CardAction className="flex items-center gap-2 self-center">
          <Switch id={`void-${customerId}`} checked={includeVoid} onCheckedChange={setIncludeVoid} data-shot="toggle-void" />
          <Label htmlFor={`void-${customerId}`} className="cursor-pointer text-sm font-normal text-muted-foreground">
            {tr("แสดงบิลที่ยกเลิก")}
          </Label>
        </CardAction>
      </CardHeader>

      <CardContent className="py-4">
        {items.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(["service", "product", "custom"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <ItemTypeIcon type={k} className="size-5" /> {ITEM_ICON[k].label}
              </span>
            ))}
          </div>
        ) : null}

        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>{tr("โหลดประวัติไม่สำเร็จ")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{errorMessage(error)}</span>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                <RotateCcw /> {tr("ลองใหม่")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : isPending ? (
          <HistorySkeleton />
        ) : items.length === 0 ? (
          <Empty className="my-2 border border-dashed bg-muted/20 py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-14 rounded-2xl bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-7">
                <History />
              </EmptyMedia>
              <EmptyTitle className="text-lg">{tr("ยังไม่เคยมาใช้บริการ")}</EmptyTitle>
              <EmptyDescription>
                {tr("{0} — เมื่อเปิดบิลขายให้ลูกค้าคนนี้ รายการจะขึ้นที่นี่พร้อมวันเวลาและสิ่งที่ทำไป", includeVoid ? tr("{0} ยังไม่มีบิลในระบบ", customerName) : tr("{0} ยังไม่มีบิลขายในระบบ", customerName))}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild size="lg" className="px-5">
                <Link href={newSaleHref(customerId)}>
                  <ShoppingCart /> {tr("เปิดบิลขายให้ลูกค้าคนนี้")}
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
            {groups.map((g, gi) => (
              <section key={g.key} className={cn(gi > 0 && "mt-2")}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  {g.label}
                  <span className="font-normal">{tr("· {0} บิล", g.items.length)}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </h3>
                <ol>
                  {g.items.map((t, i) => (
                    <TimelineEntry key={t.id} t={t} first={i === 0} last={i === g.items.length - 1} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </CardContent>

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          <span>
            {tr("แสดง {0} จาก {1} บิล", items.length.toLocaleString(LOCALE), total.toLocaleString(LOCALE))}
          </span>
          {items.length < total ? (
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => setLimit((l) => l + PAGE)} data-shot="history-more">
              {isFetching ? <Spinner /> : <ChevronRight className="rotate-90" />} {tr("โหลดเพิ่ม (อีก {0} บิล)", Math.min(PAGE, total - items.length))}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
