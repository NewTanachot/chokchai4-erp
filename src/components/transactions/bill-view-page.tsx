"use client";
/**
 * /transactions/view/?id=...[&print=1] — one bill as a document: parties, vehicle, items, totals, payment.
 * Actions: print (PrintDialog), edit, mark as paid, void (with reason), new bill from this one.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Banknote,
  Car,
  CircleCheck,
  Clock3,
  CopyPlus,
  CreditCard,
  FileQuestion,
  Gauge,
  HandCoins,
  History,
  MoreHorizontal,
  Package,
  Pencil,
  Phone,
  Printer,
  ReceiptText,
  Smartphone,
  StickyNote,
  Store,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod, type TransactionDetail, type TransactionItem } from "@shared/contract";
import { EntityHistoryCard } from "@/components/audit/entity-history";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PrintDialog } from "@/components/print/print-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBaht, formatDateLong, formatDateTime, formatQty, formatTime } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useHotkey } from "./hooks";
import { amountTone, PaymentBadge, txHref, TypeBadge, VoidBadge } from "./labels";
import { Segmented } from "./payment-fields";

const METHOD_ICONS: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  transfer: Smartphone,
  card: CreditCard,
  credit: HandCoins,
  other: HandCoins,
};

const PAID_METHOD_OPTIONS: {
  value: Exclude<PaymentMethod, "credit" | "other">;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "cash", label: tr("เงินสด"), icon: Banknote },
  { value: "transfer", label: tr("โอนเงิน"), icon: Smartphone },
  { value: "card", label: tr("บัตร"), icon: CreditCard },
];

const VOID_REASONS = [tr("ลูกค้ายกเลิก"), tr("บันทึกผิด"), tr("เปิดบิลซ้ำ")];

// ---------------------------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------------------------

function BlockTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </h3>
  );
}

function InfoLine({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function ItemIcon({ item }: { item: TransactionItem }) {
  const Icon = item.itemType === "product" ? Package : item.itemType === "service" ? Wrench : StickyNote;
  return (
    <span
      className={cn(
        "mt-0.5 hidden size-7 shrink-0 items-center justify-center rounded-md @md/doc:flex",
        item.itemType === "product"
          ? "bg-primary/8 text-primary"
          : item.itemType === "service"
            ? "bg-chart-2/12 text-chart-2"
            : "bg-muted text-muted-foreground",
      )}
      aria-hidden
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function PartyBlock({ t }: { t: TransactionDetail }) {
  const isSale = t.type === "sale";
  const c = t.customer;
  const name = c?.name ?? t.contactName;
  // contact fields that differ from the linked customer (e.g. someone else picked the car up)
  const extraContact = c && t.contactName && t.contactName !== c.name ? t.contactName : null;
  const phone = t.contactPhone ?? c?.phone ?? null;
  return (
    <div className="min-w-0">
      <BlockTitle icon={isSale ? UserRound : Store}>{isSale ? tr("ลูกค้า") : tr("ผู้ขาย / ร้านค้า")}</BlockTitle>
      {name ? (
        c ? (
          <Link
            href={`/customers/view/?id=${encodeURIComponent(c.id)}`}
            className="font-semibold break-words hover:text-primary hover:underline hover:underline-offset-3"
            data-shot="bill-customer"
          >
            {c.name}
          </Link>
        ) : (
          <div className="font-semibold break-words">{name}</div>
        )
      ) : (
        <div className="text-muted-foreground">{isSale ? tr("ลูกค้าทั่วไป") : tr("ไม่ระบุผู้ขาย")}</div>
      )}
      <div className="mt-1 space-y-0.5">
        {extraContact ? <InfoLine icon={UserRound}>{tr("ผู้ติดต่อ: {0}", extraContact)}</InfoLine> : null}
        {phone ? (
          <InfoLine icon={Phone}>
            <span className="num">{phone}</span>
          </InfoLine>
        ) : null}
        {c?.shopName ? <InfoLine icon={Store}>{c.shopName}</InfoLine> : null}
        {c?.taxId ? (
          <InfoLine icon={ReceiptText}>
            {tr("เลขผู้เสียภาษี")} <span className="num">{c.taxId}</span>
          </InfoLine>
        ) : null}
        {c?.address ? <p className="pl-5 text-sm whitespace-pre-line text-muted-foreground">{c.address}</p> : null}
      </div>
    </div>
  );
}

function VehicleBlock({ t }: { t: TransactionDetail }) {
  const has = t.vehiclePlate || t.vehicleModel || t.mileage != null;
  return (
    <div className="min-w-0">
      <BlockTitle icon={Car}>{tr("รถ")}</BlockTitle>
      {has ? (
        <>
          {t.vehiclePlate ? (
            <div className="inline-flex max-w-full items-center rounded-md border-2 border-foreground/15 bg-background px-2.5 py-0.5 font-semibold tracking-wide break-words">
              {t.vehiclePlate}
            </div>
          ) : null}
          <div className="mt-1.5 space-y-0.5">
            {t.vehicleModel ? <InfoLine icon={Car}>{t.vehicleModel}</InfoLine> : null}
            {t.mileage != null ? (
              <InfoLine icon={Gauge}>
                {tr("เลขไมล์")} <span className="num">{t.mileage.toLocaleString(LOCALE)}</span> {tr("กม.")}
              </InfoLine>
            ) : null}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">{tr("ไม่ได้ระบุ")}</div>
      )}
    </div>
  );
}

function ItemsTable({ t }: { t: TransactionDetail }) {
  const anyDiscount = t.items.some((i) => i.discount > 0);
  const grid = cn(
    "grid items-start gap-x-3",
    "grid-cols-[1.5rem_minmax(0,1fr)_auto]",
    anyDiscount ? "@xl/doc:grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_6.5rem_5.5rem_7rem]" : "@xl/doc:grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_6.5rem_7rem]",
  );
  return (
    <div>
      <div className={cn(grid, "hidden border-y bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground @xl/doc:grid")}>
        <span className="text-center">#</span>
        <span>{tr("รายการ")}</span>
        <span className="text-right">{tr("จำนวน")}</span>
        <span className="text-right">{tr("ราคา/หน่วย")}</span>
        {anyDiscount ? <span className="text-right">{tr("ส่วนลด")}</span> : null}
        <span className="text-right">{tr("รวม")}</span>
      </div>
      <ol className="divide-y border-t @xl/doc:border-t-0">
        {t.items.map((it, i) => (
          <li key={it.id} className={cn(grid, "px-5 py-2.5")} data-shot="bill-item">
            <span className="num pt-0.5 text-center text-sm text-muted-foreground">{i + 1}</span>
            <div className="flex min-w-0 gap-2.5">
              <ItemIcon item={it} />
              <div className="min-w-0">
                {it.productId ? (
                  <Link
                    href={`/products/view/?id=${encodeURIComponent(it.productId)}`}
                    className="font-medium break-words hover:text-primary hover:underline hover:underline-offset-3"
                  >
                    {it.name}
                  </Link>
                ) : (
                  <div className="font-medium break-words">{it.name}</div>
                )}
                <div className="text-xs text-muted-foreground">
                  {it.itemType === "service" ? tr("บริการ") : it.itemType === "custom" ? tr("รายการอื่น ๆ") : tr("สินค้า")}
                  {it.note ? ` · ${it.note}` : ""}
                </div>
                {/* narrow: qty × price on its own line */}
                <div className="num mt-0.5 text-sm text-muted-foreground @xl/doc:hidden">
                  {formatQty(it.qty)} {it.unit ?? ""} × {formatBaht(it.unitPrice)}
                  {it.discount > 0 ? <span className="text-expense"> {tr("− ลด {0}", formatBaht(it.discount))}</span> : null}
                </div>
              </div>
            </div>
            <span className="num hidden pt-0.5 text-right text-sm @xl/doc:block">
              {formatQty(it.qty)} <span className="text-muted-foreground">{it.unit ?? ""}</span>
            </span>
            <span className="num hidden pt-0.5 text-right text-sm @xl/doc:block">{formatBaht(it.unitPrice)}</span>
            {anyDiscount ? (
              <span className={cn("num hidden pt-0.5 text-right text-sm @xl/doc:block", it.discount > 0 ? "text-expense" : "text-muted-foreground/60")}>
                {it.discount > 0 ? `−${formatBaht(it.discount)}` : "—"}
              </span>
            ) : null}
            <span className="num pt-0.5 text-right font-medium">{formatBaht(it.total)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Totals({ t }: { t: TransactionDetail }) {
  const isVoid = t.status === "void";
  return (
    <dl className="ml-auto w-full max-w-sm space-y-1.5 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">{tr("รวมเป็นเงิน")}</dt>
        <dd className="num">{formatBaht(t.subtotal)}</dd>
      </div>
      {t.discount > 0 ? (
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{tr("ส่วนลดท้ายบิล")}</dt>
          <dd className="num text-expense">−{formatBaht(t.discount)}</dd>
        </div>
      ) : null}
      {t.vatMode !== "none" ? (
        <>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{tr("ราคาก่อน VAT")}</dt>
            <dd className="num">{formatBaht(t.total - t.vatAmount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              VAT {t.vatRate}% {t.vatMode === "inclusive" ? <span className="text-xs">{tr("(รวมในราคาแล้ว)")}</span> : null}
            </dt>
            <dd className="num">{formatBaht(t.vatAmount)}</dd>
          </div>
        </>
      ) : null}
      <div className="mt-2 flex items-end justify-between gap-4 border-t border-dashed pt-2.5">
        <dt className="pb-0.5 font-medium">{tr("ยอดสุทธิ")}</dt>
        <dd
          className={cn("num text-3xl leading-none font-bold tracking-tight", isVoid ? "text-muted-foreground line-through decoration-2" : amountTone(t.type))}
          data-shot="view-total"
        >
          {formatBaht(t.total)}
        </dd>
      </div>
    </dl>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------

function MarkPaidDialog({ t, open, onOpenChange }: { t: TransactionDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const initial = t.paymentMethod === "credit" || t.paymentMethod === "other" ? "cash" : t.paymentMethod;
  const [method, setMethod] = useState<(typeof PAID_METHOD_OPTIONS)[number]["value"]>(initial);
  useEffect(() => {
    if (open) setMethod(initial);
  }, [open, initial]);
  const isSale = t.type === "sale";
  const pay = useApiMutation(() => api.transactions.markPaid({ id: t.id, paymentMethod: method }), {
    successMessage: isSale ? tr("บันทึกรับชำระบิล {0} แล้ว", t.docNo) : tr("บันทึกจ่ายเงินบิล {0} แล้ว", t.docNo),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-shot="mark-paid-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{isSale ? tr("รับชำระเงิน") : tr("บันทึกว่าจ่ายเงินแล้ว")}</DialogTitle>
            <DialogDescription>
              {tr("บิล")} <span className="num">{t.docNo}</span> · {t.customer?.name ?? t.contactName ?? (isSale ? tr("ลูกค้าทั่วไป") : tr("ไม่ระบุผู้ขาย"))}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-baseline justify-between rounded-lg bg-muted/60 px-4 py-3">
            <span className="text-sm text-muted-foreground">{isSale ? tr("ยอดที่รับ") : tr("ยอดที่จ่าย")}</span>
            <span className={cn("num text-2xl font-bold", amountTone(t.type))}>{formatBaht(t.total)}</span>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted-foreground">{isSale ? tr("ลูกค้าชำระด้วย") : tr("ร้านจ่ายด้วย")}</div>
            <Segmented ariaLabel={tr("วิธีชำระเงิน")} value={method} onChange={setMethod} options={PAID_METHOD_OPTIONS} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" className="h-10 px-4" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              {tr("ปิด")}
            </Button>
            <Button type="submit" size="lg" className="h-10 px-4" disabled={pay.isPending} autoFocus data-shot="confirm-paid">
              {pay.isPending ? <Spinner /> : <CircleCheck />}
              {isSale ? tr("ยืนยันรับชำระแล้ว") : tr("ยืนยันจ่ายแล้ว")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ t, open, onOpenChange }: { t: TransactionDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const isSale = t.type === "sale";
  const doVoid = useApiMutation(() => api.transactions.void({ id: t.id, reason }), { successMessage: tr("ยกเลิกบิล {0} แล้ว", t.docNo) });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tr("ยกเลิกบิล {0}?", t.docNo)}
      description={
        isSale
          ? tr("สินค้าในบิลจะถูกคืนเข้าสต็อก และบิลนี้จะไม่นับในยอดขาย บิลยังเก็บไว้ดูย้อนหลังได้ แต่จะแก้ไขอีกไม่ได้")
          : tr("สต็อกที่รับเข้าจากบิลนี้จะถูกหักออก และบิลนี้จะไม่นับในยอดซื้อ บิลยังเก็บไว้ดูย้อนหลังได้ แต่จะแก้ไขอีกไม่ได้")
      }
      confirmText={tr("ยกเลิกบิล")}
      cancelText={tr("ไม่ยกเลิก")}
      destructive
      onConfirm={() => doVoid.mutate()}
    >
      <div className="grid gap-2" data-shot="void-dialog">
        <label htmlFor="void-reason" className="text-sm font-medium">
          {tr("เหตุผลที่ยกเลิก")} <span className="font-normal text-muted-foreground">{tr("(ไม่บังคับ)")}</span>
        </label>
        <Textarea
          id="void-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={tr("เช่น ลูกค้ายกเลิก, บันทึกราคาผิด")}
          className="min-h-20"
          autoFocus
        />
        <div className="flex flex-wrap gap-1.5">
          {VOID_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                reason === r ? "border-destructive/40 bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

function ViewSkeleton() {
  return (
    <div aria-busy>
      <div className="mb-5 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid gap-4 @min-[58rem]/view:grid-cols-[minmax(0,1fr)_300px]">
        <Skeleton className="h-[26rem] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function NotFound({ description }: { description: React.ReactNode }) {
  return (
    <Empty className="mt-10 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle className="text-base">{tr("ไม่พบบิลนี้")}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="lg" className="h-10">
          <Link href="/transactions/">{tr("ไปที่รายการซื้อ-ขาย")}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function BillViewPage() {
  const id = useSearchParam("id");
  const wantPrint = useSearchParam("print") === "1";
  const bill = useQuery({
    queryKey: ["transactions", "get", id],
    queryFn: () => api.transactions.get(id!),
    enabled: !!id,
  });

  return (
    <div className="@container/view">
      {!id ? (
        <NotFound description={tr("ลิงก์ไม่ถูกต้อง กรุณาเลือกบิลจากรายการซื้อ-ขาย")} />
      ) : bill.isError ? (
        <NotFound description={errorMessage(bill.error)} />
      ) : bill.isPending ? (
        <ViewSkeleton />
      ) : (
        <BillView key={bill.data.id} t={bill.data} wantPrint={wantPrint} />
      )}
    </div>
  );
}

function BillView({ t, wantPrint }: { t: TransactionDetail; wantPrint: boolean }) {
  const router = useRouter();
  const { can } = useAuth();
  const isSale = t.type === "sale";
  const isVoid = t.status === "void";
  const unpaid = !isVoid && t.paymentStatus === "unpaid";
  // Purchases need the purchase permission for anything beyond viewing / printing.
  const canTouch = isSale || can("purchases.create");
  const canEdit = canTouch && can("transactions.edit");
  const canVoid = canTouch && can("transactions.void");
  const canPay = canTouch;
  const canSeeProfit = can("reports.view");
  const [printOpen, setPrintOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [modKey, setModKey] = useState("Ctrl+");
  useEffect(() => {
    if (window.erp?.platform === "darwin" || /Mac/.test(navigator.platform)) setModKey("⌘");
  }, []);

  // ?print=1 (after "บันทึกและพิมพ์" / auto print): open once, then drop the flag so a reload doesn't reopen it.
  useEffect(() => {
    if (!wantPrint) return;
    if (!isVoid) setPrintOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("print");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [wantPrint, isVoid]);

  useHotkey(
    "mod+p",
    (e) => {
      e.preventDefault();
      setPrintOpen(true);
    },
    !isVoid,
  );

  const MethodIcon = METHOD_ICONS[t.paymentMethod];
  const who = t.customer?.name ?? t.contactName;
  const edited = t.updatedAt - t.createdAt > 1000;
  const grossProfit = t.total - t.vatAmount - t.costTotal;
  const productLines = t.items.filter((i) => i.itemType === "product").length;

  const printButton = (primary: boolean) => (
    <Button variant={primary ? "default" : "outline"} size="lg" className="h-10 px-4" onClick={() => setPrintOpen(true)} data-shot="print-bill">
      <Printer /> {tr("พิมพ์")}
      <Kbd className={cn("ml-0.5 hidden @3xl/view:inline-flex", primary ? "bg-primary-foreground/15 text-primary-foreground/80" : "")}>{modKey}P</Kbd>
    </Button>
  );

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <Link href={txHref.list()} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {tr("รายการซื้อ-ขาย")}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className={cn("num text-2xl font-semibold tracking-tight", isVoid && "text-muted-foreground line-through decoration-2")}>{t.docNo}</h1>
            <TypeBadge type={t.type} className="h-7 px-2.5 text-sm" />
            {isVoid ? <VoidBadge className="h-7 px-2.5 text-sm" /> : <PaymentBadge status={t.paymentStatus} className="h-7 px-2.5 text-sm" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("{0} · {1} เวลา", isSale ? tr("บิลขาย") : tr("บิลซื้อ"), formatDateLong(t.occurredAt))} <span className="num">{tr("{0} น.", formatTime(t.occurredAt))}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isVoid ? (
            <>
              {unpaid && canPay ? (
                <Button
                  size="lg"
                  className="h-10 bg-success px-4 text-success-foreground hover:bg-success/85"
                  onClick={() => setPayOpen(true)}
                  data-shot="mark-paid"
                >
                  <CircleCheck /> {isSale ? tr("รับชำระแล้ว") : tr("จ่ายแล้ว")}
                </Button>
              ) : null}
              {printButton(!(unpaid && canPay))}
              {canEdit ? (
                <Button asChild variant="outline" size="lg" className="h-10 px-4">
                  <Link href={txHref.edit(t.id)} data-shot="edit-bill">
                    <Pencil /> {tr("แก้ไข")}
                  </Link>
                </Button>
              ) : null}
            </>
          ) : canTouch ? (
            <Button asChild variant="outline" size="lg" className="h-10 px-4">
              <Link href={txHref.new(t.type, { from: t.id })} data-shot="copy-bill-void">
                <CopyPlus /> {tr("เปิดบิลใหม่จากบิลนี้")}
              </Link>
            </Button>
          ) : null}
          {(!isVoid && (canTouch || canVoid)) || t.customerId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="h-10 px-3" aria-label={tr("คำสั่งอื่น ๆ")} data-shot="more-actions">
                  <MoreHorizontal /> {tr("อื่น ๆ")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {!isVoid && canTouch ? (
                  <DropdownMenuItem className="py-2" onSelect={() => router.push(txHref.new(t.type, { from: t.id }))} data-shot="copy-bill">
                    <CopyPlus /> {tr("เปิดบิลใหม่จากบิลนี้")}
                  </DropdownMenuItem>
                ) : null}
                {t.customerId ? (
                  <DropdownMenuItem
                    className="py-2"
                    onSelect={() =>
                      router.push(
                        txHref.list({
                          customerId: t.customerId!,
                          range: "all",
                        }),
                      )
                    }
                  >
                    <History /> {isSale ? tr("บิลทั้งหมดของลูกค้านี้") : tr("บิลทั้งหมดของผู้ติดต่อนี้")}
                  </DropdownMenuItem>
                ) : null}
                {!isVoid && canVoid ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" className="py-2" onSelect={() => setVoidOpen(true)} data-shot="void-bill">
                      <Ban /> {tr("ยกเลิกบิล…")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {/* Banners */}
      {isVoid ? (
        <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3" data-shot="void-banner">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <Ban className="size-4" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-destructive">
              {tr("บิลนี้ถูกยกเลิกแล้ว{0}{1}", t.voidedAt ? tr(" เมื่อ {0} น.", formatDateTime(t.voidedAt)) : "", t.voidedBy ? tr(" โดย {0}", t.voidedBy.name) : "")}
            </p>
            <p className="mt-0.5 text-foreground/80">{tr("เหตุผล:")} {t.voidReason ?? <span className="text-muted-foreground">{tr("ไม่ได้ระบุ")}</span>}</p>
            <p className="mt-0.5 text-muted-foreground">
              {tr("{0} · ต้องการบิลที่ถูกต้อง กด “เปิดบิลใหม่จากบิลนี้”", isSale ? tr("ไม่นับในยอดขาย และคืนสินค้าเข้าสต็อกแล้ว") : tr("ไม่นับในยอดซื้อ และหักสต็อกที่รับเข้าออกแล้ว"))}
            </p>
          </div>
        </div>
      ) : unpaid ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3" data-shot="unpaid-banner">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/25 text-warning-foreground dark:text-warning">
            <Clock3 className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">
              {isSale ? tr("ลูกค้ายังไม่ได้ชำระ") : tr("ร้านยังไม่ได้จ่ายเงินบิลนี้")} <span className="num">{formatBaht(t.total)}</span>
            </p>
            <p className="text-muted-foreground">
              {isSale ? tr("เมื่อได้รับเงินแล้ว กด “รับชำระแล้ว” เพื่อปิดยอดค้าง") : tr("เมื่อจ่ายเงินให้ผู้ขายแล้ว กด “จ่ายแล้ว” เพื่อปิดยอดค้าง")}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 @min-[58rem]/view:grid-cols-[minmax(0,1fr)_300px] @min-[58rem]/view:items-start">
        {/* Document */}
        <Card className={cn("@container/doc gap-0 overflow-hidden py-0", isVoid && "border-dashed")}>
          <div className="grid gap-5 px-5 py-4 @xl/doc:grid-cols-2">
            <PartyBlock t={t} />
            {isSale ? <VehicleBlock t={t} /> : null}
          </div>
          <ItemsTable t={t} />
          <div className="flex flex-col gap-4 border-t px-5 py-4 @xl/doc:flex-row @xl/doc:items-end">
            <div className="min-w-0 flex-1">
              {t.note ? (
                <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                  <BlockTitle icon={StickyNote}>{tr("หมายเหตุ")}</BlockTitle>
                  <p className="text-sm whitespace-pre-line">{t.note}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tr("{0} รายการ · รวม", t.items.length)} <span className="num">{formatQty(t.items.reduce((s, i) => s + i.qty, 0))}</span> {tr("หน่วย")}
                </p>
              )}
            </div>
            <Totals t={t} />
          </div>
        </Card>

        {/* Side */}
        <div className="grid gap-4 @min-[40rem]/view:grid-cols-2 @min-[58rem]/view:grid-cols-1">
          <Card className="gap-3 px-4 py-4">
            <h2 className="text-sm font-semibold">{tr("การชำระเงิน")}</h2>
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MethodIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{PAYMENT_METHOD_LABELS[t.paymentMethod]}</div>
                <div className="text-xs text-muted-foreground">
                  {isVoid ? tr("บิลถูกยกเลิก") : t.paymentStatus === "paid" ? (isSale ? tr("ได้รับเงินแล้ว") : tr("จ่ายเงินแล้ว")) : isSale ? tr("รอลูกค้าชำระ") : tr("รอร้านจ่าย")}
                </div>
              </div>
              {isVoid ? <VoidBadge /> : <PaymentBadge status={t.paymentStatus} />}
            </div>
            {unpaid && canPay ? (
              <Button
                variant="outline"
                size="lg"
                className="h-10 w-full border-success/40 text-success hover:bg-success/10 hover:text-success"
                onClick={() => setPayOpen(true)}
              >
                <CircleCheck /> {isSale ? tr("บันทึกรับชำระ") : tr("บันทึกจ่ายเงิน")}
              </Button>
            ) : null}
          </Card>

          {isSale && !isVoid && productLines > 0 && canSeeProfit ? (
            <Card className="gap-2.5 px-4 py-4" data-shot="profit-card">
              <h2 className="text-sm font-semibold">{tr("กำไรขั้นต้น (ประมาณ)")}</h2>
              <dl className="space-y-1.5">
                <MetaRow label={tr("ยอดขาย (ก่อน VAT)")}>
                  <span className="num">{formatBaht(t.total - t.vatAmount)}</span>
                </MetaRow>
                <MetaRow label={tr("ต้นทุนสินค้า")}>
                  <span className="num">−{formatBaht(t.costTotal)}</span>
                </MetaRow>
                <div className="flex items-baseline justify-between gap-3 border-t pt-1.5 text-sm">
                  <dt className="font-medium">{tr("กำไรขั้นต้น")}</dt>
                  <dd className={cn("num font-semibold", grossProfit >= 0 ? "text-income" : "text-expense")}>{formatBaht(grossProfit)}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">{tr("คิดจากต้นทุนสินค้า ณ วันที่ขาย (บริการไม่มีต้นทุน)")}</p>
            </Card>
          ) : null}

          <Card className="gap-2.5 px-4 py-4">
            <h2 className="text-sm font-semibold">{tr("ข้อมูลบิล")}</h2>
            <dl className="space-y-1.5">
              <MetaRow label={tr("เลขที่บิล")}>
                <span className="num font-medium">{t.docNo}</span>
              </MetaRow>
              <MetaRow label={tr("ประเภท")}>{isSale ? tr("ขาย") : tr("ซื้อ")}</MetaRow>
              <MetaRow label={tr("วันที่ในบิล")}>
                <span className="num">{tr("{0} น.", formatDateTime(t.occurredAt))}</span>
              </MetaRow>
              <MetaRow label={tr("บันทึกเมื่อ")}>
                <span className="num">{tr("{0} น.", formatDateTime(t.createdAt))}</span>
              </MetaRow>
              <MetaRow label={tr("ผู้บันทึก")}>
                <span data-shot="bill-created-by">{t.createdBy?.name ?? <span className="text-muted-foreground">{tr("ไม่ระบุ")}</span>}</span>
              </MetaRow>
              {edited ? (
                <MetaRow label={isVoid ? tr("อัปเดตล่าสุด") : tr("แก้ไขล่าสุด")}>
                  <span className="num">{tr("{0} น.", formatDateTime(t.updatedAt))}</span>
                  {t.updatedBy && t.updatedBy.id !== t.createdBy?.id ? <span className="block text-xs text-muted-foreground">{tr("โดย {0}", t.updatedBy.name)}</span> : null}
                </MetaRow>
              ) : null}
              <MetaRow label={tr("จำนวนรายการ")}>{tr("{0} รายการ", t.items.length)}</MetaRow>
              {who && t.customerId ? (
                <MetaRow label={isSale ? tr("ลูกค้า") : tr("ผู้ติดต่อ")}>
                  <Link href={`/customers/view/?id=${encodeURIComponent(t.customerId)}`} className="text-primary hover:underline">
                    {tr("ดูประวัติ")}
                  </Link>
                </MetaRow>
              ) : null}
            </dl>
          </Card>
        </div>
      </div>

      {can("audit.view") ? <EntityHistoryCard entityType="transaction" entityId={t.id} className="mt-4" description={tr("ใครเปิด แก้ไข รับชำระ หรือยกเลิกบิลนี้ และแก้อะไรไปบ้าง")} /> : null}

      {!isVoid ? <PrintDialog transactionId={t.id} transactionType={t.type} open={printOpen} onOpenChange={setPrintOpen} /> : null}
      {unpaid && canPay ? <MarkPaidDialog t={t} open={payOpen} onOpenChange={setPayOpen} /> : null}
      {!isVoid && canVoid ? <VoidDialog t={t} open={voidOpen} onOpenChange={setVoidOpen} /> : null}
    </>
  );
}
