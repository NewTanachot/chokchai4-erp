"use client";
/**
 * Bill form for new / edited sales and purchases.
 * Left: item search + editable lines. Right (sticky on wide screens): customer & vehicle, payment, totals, save.
 * Totals use shared/calc (same math as the main process, which stores the authoritative values).
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Car, Gauge, NotebookPen, Phone, Plus, Printer, Save, Store, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { computeTotals } from "@shared/calc";
import type { Customer, CustomerVehicle, Product, ServiceItem, TransactionDetail, TransactionType } from "@shared/contract";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/api";
import { formatBaht, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { setUnsavedWork } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import {
  draftToInput,
  newCustomLine,
  newProductLine,
  newServiceLine,
  validateDraft,
  type BillDraft,
  type DraftCustomer,
  type DraftLine,
} from "./bill-draft";
import { BillLines, LinesEmpty, stockShortages, type LineContext } from "./bill-lines";
import { CustomerPicker } from "./customer-picker";
import { DateTimeField } from "./date-time-field";
import { useHotkey, useNextDocNo, useSettings } from "./hooks";
import { ItemSearch, type ItemPick } from "./item-search";
import { txHref, TYPE_TITLES } from "./labels";
import { METHOD_OPTIONS, Segmented, STATUS_OPTIONS, vatOptions } from "./payment-fields";

const signature = (d: BillDraft) => JSON.stringify({ ...d, lines: d.lines.map(({ key: _k, ...rest }) => rest) });

function SectionTitle({ icon: Icon, children, action }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" />
        {children}
      </h2>
      {action}
    </div>
  );
}

function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium text-muted-foreground">
      <span>{children}</span>
      {hint ? <span className="text-xs font-normal">{hint}</span> : null}
    </Label>
  );
}

/** Product / service objects for the lines (live stock, catalog prices). null = deleted. */
function useLineCatalog(lines: DraftLine[]) {
  const productIds = useMemo(() => [...new Set(lines.flatMap((l) => (l.productId ? [l.productId] : [])))], [lines]);
  const serviceIds = useMemo(() => [...new Set(lines.flatMap((l) => (l.serviceItemId ? [l.serviceItemId] : [])))], [lines]);
  const productQs = useQueries({
    queries: productIds.map((id) => ({
      queryKey: ["products", "get", id],
      queryFn: () => api.products.get(id),
      retry: false,
    })),
  });
  const serviceQs = useQueries({
    queries: serviceIds.map((id) => ({
      queryKey: ["serviceItems", "get", id],
      queryFn: () => api.serviceItems.get(id),
      retry: false,
    })),
  });
  const products = new Map<string, Product | null>();
  productIds.forEach((id, i) => {
    const q = productQs[i];
    if (q?.data) products.set(id, q.data);
    else if (q?.error instanceof ApiClientError && q.error.code === "NOT_FOUND") products.set(id, null);
  });
  const services = new Map<string, ServiceItem | null>();
  serviceIds.forEach((id, i) => {
    const q = serviceQs[i];
    if (q?.data) services.set(id, q.data);
    else if (q?.error instanceof ApiClientError && q.error.code === "NOT_FOUND") services.set(id, null);
  });
  return { products, services };
}

/** Suggestions of supplier names from earlier purchases. */
function useSupplierNames(enabled: boolean) {
  const q = useQuery({
    queryKey: ["transactions", "list", { type: "purchase", limit: 300 }],
    queryFn: () => api.transactions.list({ type: "purchase", limit: 300 }),
    enabled,
    staleTime: 60_000,
  });
  return useMemo(() => [...new Set((q.data?.items ?? []).map((t) => t.displayName).filter((n): n is string => !!n))].slice(0, 50), [q.data]);
}

/**
 * Keeps a sticky column inside the viewport: --side-max = space from its current top to the bottom of the
 * window (before the page scrolls, the column starts below the page title, not at its sticky offset).
 */
function useFitToViewport(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = Math.max(el.getBoundingClientRect().top, 0);
      el.style.setProperty("--side-max", `${Math.max(360, Math.floor(window.innerHeight - top - 16))}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [ref]);
}

/** "พอดี" + round-ups to the next 100 / 500 / 1,000 baht for the cash helper. */
function quickCash(total: number): number[] {
  if (total <= 0) return [];
  const up = (step: number) => Math.ceil(total / step) * step;
  return [...new Set([total, up(10_000), up(50_000), up(100_000)])];
}

export function BillForm({
  type,
  mode,
  initial,
  original,
}: {
  type: TransactionType;
  mode: "new" | "edit";
  initial: BillDraft;
  original?: TransactionDetail;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { settings } = useSettings();
  const [draft, setDraft] = useState<BillDraft>(initial);
  const [initialSig] = useState(() => signature(initial));
  // New bill: the number it will get, for the month of the bill date as currently set.
  const docNoPreview = useNextDocNo(type, draft.occurredAt, { enabled: mode === "new" });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<number | null>(null);
  const [newCustomer, setNewCustomer] = useState<{ open: boolean; typed: string }>({ open: false, typed: "" });
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(!!initial.note);
  const searchRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  useFitToViewport(sideRef);
  // The customer/payment area scrolls inside the sticky column: fade its bottom edge while more is below.
  const sideScrollRef = useRef<HTMLDivElement>(null);
  const [sideMore, setSideMore] = useState(false);
  const updateSideMore = useCallback(() => {
    const el = sideScrollRef.current;
    if (el) setSideMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    const el = sideScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateSideMore);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [updateSideMore]);
  const savedRef = useRef(false);
  // Narrow layout: the sticky bottom bar (total + save) is hidden while the totals card itself is on screen.
  const totalsRef = useRef<HTMLDivElement>(null);
  const [totalsVisible, setTotalsVisible] = useState(false);
  useEffect(() => {
    const el = totalsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setTotalsVisible(entry.isIntersecting), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const isSale = type === "sale";
  const [modKey, setModKey] = useState("Ctrl+");
  useEffect(() => {
    if (window.erp?.platform === "darwin" || /Mac/.test(navigator.platform)) setModKey("⌘");
  }, []);

  const dirty = signature(draft) !== initialSig;
  const set = useCallback(<K extends keyof BillDraft>(k: K, v: BillDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError(null);
  }, []);

  // ---- lines ----
  const catalog = useLineCatalog(draft.lines);
  const originalQty = useMemo(() => {
    const m = new Map<string, number>();
    if (original && original.status === "completed" && original.type === "sale") {
      for (const i of original.items) if (i.productId) m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty);
    }
    return m;
  }, [original]);
  const lineCtx: LineContext = { ...catalog, originalQty, vat: { mode: draft.vatMode, rate: draft.vatRate } };
  const shortages = stockShortages(type, draft.lines, lineCtx);

  const addPick = (pick: ItemPick) => {
    setError(null);
    if (pick.kind === "product") qc.setQueryData(["products", "get", pick.product.id], pick.product);
    else qc.setQueryData(["serviceItems", "get", pick.service.id], pick.service);
    setDraft((d) => {
      const existing = d.lines.find((l) => (pick.kind === "product" ? l.productId === pick.product.id : l.serviceItemId === pick.service.id));
      if (existing) {
        setHighlight(existing.key);
        return { ...d, lines: d.lines.map((l) => (l.key === existing.key ? { ...l, qty: Math.round((l.qty + 1) * 100) / 100 } : l)) };
      }
      const line = pick.kind === "product" ? newProductLine(type, pick.product) : newServiceLine(type, pick.service);
      setHighlight(line.key);
      return { ...d, lines: [...d.lines, line] };
    });
  };

  const addCustom = () => {
    const line = newCustomLine();
    setHighlight(line.key);
    setDraft((d) => ({ ...d, lines: [...d.lines, line] }));
  };

  const patchLine = (key: string, patch: Partial<DraftLine>) => {
    setError(null);
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  };
  const removeLine = (key: string) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) }));

  useEffect(() => {
    if (!highlight) return;
    document.querySelector(`[data-line-key="${highlight}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => setHighlight(null), 1200);
    return () => clearTimeout(t);
  }, [highlight, draft.lines.length]);

  // ---- totals ----
  const totals = computeTotals({ lines: draft.lines, discount: draft.discount, vatMode: draft.vatMode, vatRate: draft.vatRate });
  const itemQty = draft.lines.reduce((s, l) => s + (l.qty || 0), 0);
  const showVat = settings.tax.vatRegistered || draft.vatMode !== "none";
  const change = received !== null ? received - totals.total : null;

  // ---- customer ----
  const setCustomer = (c: DraftCustomer | null) => {
    setDraft((d) => {
      const next = { ...d, customer: c };
      if (c && isSale && !d.vehiclePlate && c.vehiclePlates.length === 1) next.vehiclePlate = c.vehiclePlates[0];
      return next;
    });
    // one known car: also bring its model once the customer's vehicles are loaded
    if (c && isSale && c.vehiclePlates.length === 1) {
      const plate = c.vehiclePlates[0];
      void qc
        .fetchQuery({ queryKey: ["customers", "get", c.id], queryFn: () => api.customers.get(c.id), staleTime: 30_000 })
        .then((detail) => {
          const model = detail.vehicles.find((v) => v.plate === plate)?.model;
          if (model) setDraft((d) => (d.customer?.id === c.id && d.vehiclePlate === plate && !d.vehicleModel.trim() ? { ...d, vehicleModel: model } : d));
        })
        .catch(() => undefined);
    }
  };
  // Known vehicles of the chosen customer (plate -> model / last mileage) for the quick-pick chips.
  const customerDetail = useQuery({
    queryKey: ["customers", "get", draft.customer?.id ?? null],
    queryFn: () => api.customers.get(draft.customer!.id),
    enabled: isSale && !!draft.customer?.id,
    retry: false,
    staleTime: 30_000,
  });
  const knownVehicles: CustomerVehicle[] = useMemo(() => {
    const plates = draft.customer?.vehiclePlates ?? [];
    const detail = customerDetail.data?.id === draft.customer?.id ? (customerDetail.data?.vehicles ?? []) : [];
    const byPlate = new Map(detail.map((v) => [v.plate, v]));
    for (const p of plates) if (!byPlate.has(p)) byPlate.set(p, { plate: p, model: null, lastMileage: null, lastSeenAt: 0, visitCount: 0 });
    return [...byPlate.values()].slice(0, 6);
  }, [draft.customer, customerDetail.data]);
  const currentVehicle = knownVehicles.find((v) => v.plate === draft.vehiclePlate.trim());
  const pickVehicle = (v: CustomerVehicle) => {
    setDraft((d) => {
      // replace the model only when it is empty or came from another known vehicle
      const modelIsKnown = !d.vehicleModel.trim() || knownVehicles.some((k) => k.model === d.vehicleModel);
      return { ...d, vehiclePlate: v.plate, vehicleModel: v.model && modelIsKnown ? v.model : d.vehicleModel };
    });
    setError(null);
  };

  const onCustomerCreated = (c: Customer) => {
    setCustomer({ id: c.id, name: c.name, phone: c.phone, shopName: c.shopName, vehiclePlates: [] });
  };
  const suppliers = useSupplierNames(!isSale);

  // ---- save ----
  const save = useApiMutation(
    async (vars: { print: boolean }) => {
      void vars;
      const input = draftToInput(type, draft);
      return mode === "edit" && original ? api.transactions.update({ ...input, id: original.id }) : api.transactions.create(input);
    },
    {
      successMessage: (bill) => (mode === "edit" ? tr("บันทึกการแก้ไขบิล {0} แล้ว", bill.docNo) : tr("บันทึกบิล {0} แล้ว", bill.docNo)),
      onSuccess: (bill, vars) => {
        savedRef.current = true;
        const autoPrint = mode === "new" && isSale && settings.print.autoPrintAfterSale;
        router.push(txHref.view(bill.id, vars.print || autoPrint ? { print: "1" } : undefined));
      },
      onError: (e) => setError(e.message),
    },
  );

  const submit = (print: boolean) => {
    if (save.isPending) return;
    const problem = validateDraft(type, draft);
    if (problem) {
      setError(problem);
      toast.error(problem);
      if (draft.lines.length === 0) searchRef.current?.focus();
      return;
    }
    save.mutate({ print });
  };

  // Shortcuts belong to the bill only while no dialog (new customer, leave confirmation...) is on top.
  const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
  useHotkey("F2", (e) => {
    if (dialogOpen()) return;
    e.preventDefault();
    searchRef.current?.focus();
  });
  useHotkey("mod+s", (e) => {
    e.preventDefault();
    if (!dialogOpen()) submit(false);
  });

  // Logging out / the auto-lock ask first (or wait) while the bill has unsaved changes.
  useEffect(() => {
    setUnsavedWork("bill-form", dirty && !savedRef.current);
    return () => setUnsavedWork("bill-form", false);
  }, [dirty]);

  // ---- leave guard: closing the window / quitting / reloading with unsaved changes asks first ----
  // (electron/window.ts shows the native question when the page blocks the unload)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (savedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ---- leave guard: confirm before navigating away with unsaved changes ----
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (savedRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const cancel = () => {
    const back = original ? txHref.view(original.id) : "/transactions/";
    if (dirty) setLeaveTo(back);
    else router.push(back);
  };

  const title = mode === "edit" && original ? tr("แก้ไขบิล {0}", original.docNo) : TYPE_TITLES[type];
  const subtitle =
    mode === "edit" && original ? (
      <>{isSale ? tr("บิลขาย · สร้างเมื่อ {0}", formatDateTime(original.createdAt)) : tr("บิลซื้อ · สร้างเมื่อ {0}", formatDateTime(original.createdAt))}</>
    ) : docNoPreview ? (
      <>
        {tr("เลขที่บิล ")}
        <span className="num font-medium text-foreground" data-shot="docno-preview">
          {docNoPreview}
        </span>{tr(" (ออกให้อัตโนมัติเมื่อบันทึก)")}
      </>
    ) : (
      <>{tr("เลขที่บิลจะออกให้อัตโนมัติเมื่อบันทึก")}</>
    );

  return (
    <div className="@container/bill">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={cancel} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            {original ? tr("กลับไปหน้าบิล") : tr("รายการซื้อ-ขาย")}
          </button>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span className={cn("inline-block size-2.5 rounded-full", isSale ? "bg-income" : "bg-chart-5")} aria-hidden />
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <DateTimeField value={draft.occurredAt} onChange={(v) => set("occurredAt", v)} allowNow={mode === "new"} />
      </div>

      <div className="grid gap-4 @min-[60rem]/bill:grid-cols-[minmax(0,1fr)_340px] @min-[60rem]/bill:items-start @min-[76rem]/bill:grid-cols-[minmax(0,1fr)_370px]">
        {/* LEFT: items */}
        <div className="min-w-0 space-y-4">
          <Card className="gap-0 overflow-visible py-0">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <ItemSearch type={type} onPick={addPick} inputRef={searchRef} className="min-w-[240px] flex-1" />
              <Button type="button" variant="outline" className="h-12 rounded-xl px-4" onClick={addCustom} data-shot="add-custom">
                <Plus /> {tr("รายการอื่น ๆ")}
              </Button>
            </div>
            {draft.lines.length ? (
              <div className="pt-2">
                <BillLines type={type} lines={draft.lines} ctx={lineCtx} onChange={patchLine} onRemove={removeLine} highlightKey={highlight} />
              </div>
            ) : (
              <LinesEmpty type={type} />
            )}
            {draft.lines.length ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
                <span>
                  {tr("{0} รายการ · รวม", draft.lines.length)} <span className="num">{formatQty(itemQty)}</span> {tr("หน่วย")}
                  {shortages.size ? <span className="ml-2 font-medium text-warning-foreground dark:text-warning">{tr("· สต็อกไม่พอ {0} รายการ", shortages.size)}</span> : null}
                </span>
                <span>
                  {tr("รวมเป็นเงิน")} <span className="num font-semibold text-foreground">{formatBaht(totals.subtotal)}</span>
                </span>
              </div>
            ) : null}
          </Card>

          <Card className="gap-3 py-3.5">
            <div className="px-4">
              <SectionTitle
                icon={NotebookPen}
                action={
                  !showNote ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowNote(true)}>
                      <Plus /> {tr("เพิ่มหมายเหตุ")}
                    </Button>
                  ) : null
                }
              >
                {tr("หมายเหตุ")}
              </SectionTitle>
              {showNote ? (
                <Textarea
                  value={draft.note}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder={isSale ? tr("เช่น นัดรับรถ 17:00, รับประกันยาง 1 ปี") : tr("เช่น เลขที่ใบกำกับของผู้ขาย, ครบกำหนดชำระ")}
                  className="mt-2.5 min-h-20"
                  autoFocus={!initial.note}
                />
              ) : null}
            </div>
          </Card>
        </div>

        {/* RIGHT: customer / payment / totals */}
        {/* Wide: sticky column; customer scrolls if needed; payment + totals + save always stay in view. */}
        <div
          ref={sideRef}
          className="@container/side space-y-4 @min-[60rem]/bill:sticky @min-[60rem]/bill:top-[4.5rem] @min-[60rem]/bill:flex @min-[60rem]/bill:max-h-(--side-max,calc(100svh-5.5rem)) @min-[60rem]/bill:flex-col @min-[60rem]/bill:gap-3 @min-[60rem]/bill:space-y-0"
        >
          <div
            ref={sideScrollRef}
            onScroll={updateSideMore}
            data-more={sideMore || undefined}
            className="grid gap-4 @min-[36rem]/side:grid-cols-2 @min-[36rem]/side:items-start @min-[60rem]/bill:min-h-0 @min-[60rem]/bill:flex-1 @min-[60rem]/bill:auto-rows-max @min-[60rem]/bill:content-start @min-[60rem]/bill:gap-3 @min-[60rem]/bill:overflow-y-auto @min-[60rem]/bill:overscroll-contain @min-[60rem]/bill:rounded-xl @min-[60rem]/bill:[scrollbar-width:thin] @min-[60rem]/bill:data-more:[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]"
          >
            <Card className="gap-3.5 py-4">
              <div className="space-y-3.5 px-4">
                {isSale ? (
                  <>
                    <SectionTitle icon={UserRound}>{tr("ลูกค้า")}</SectionTitle>
                    <CustomerPicker value={draft.customer} onChange={setCustomer} onCreate={(typed) => setNewCustomer({ open: true, typed })} />
                    {!draft.customer ? (
                      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                        <Input value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder={tr("ชื่อ (ลูกค้าทั่วไป)")} aria-label={tr("ชื่อลูกค้า")} />
                        <Input value={draft.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder={tr("เบอร์โทร")} inputMode="tel" aria-label={tr("เบอร์โทรลูกค้า")} />
                      </div>
                    ) : null}
                    <div className="space-y-2.5 border-t pt-3.5">
                      <SectionTitle icon={Car}>{tr("รถ")}</SectionTitle>
                      <div>
                        <Input value={draft.vehiclePlate} onChange={(e) => set("vehiclePlate", e.target.value)} placeholder={tr("ทะเบียนรถ เช่น กข 1234 กรุงเทพมหานคร")} aria-label={tr("ทะเบียนรถ")} className="h-9" />
                        {knownVehicles.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={tr("รถที่ลูกค้าเคยนำมา")}>
                            {knownVehicles.map((v) => (
                              <button
                                key={v.plate}
                                type="button"
                                onClick={() => pickVehicle(v)}
                                title={v.model ? `${v.plate} · ${v.model}` : v.plate}
                                className={cn(
                                  "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                                  draft.vehiclePlate.trim() === v.plate ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                                data-shot="plate-chip"
                              >
                                <Car className="size-3 shrink-0" />
                                <span className="truncate">{v.plate}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                        <Input value={draft.vehicleModel} onChange={(e) => set("vehicleModel", e.target.value)} placeholder={tr("รุ่นรถ เช่น Toyota Vios")} aria-label={tr("รุ่นรถ")} />
                        <div className="relative">
                          <Gauge className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={draft.mileage}
                            onChange={(e) => set("mileage", e.target.value.replace(/[^\d,]/g, ""))}
                            placeholder={tr("เลขไมล์")}
                            inputMode="numeric"
                            className="num pl-8"
                            aria-label={tr("เลขไมล์")}
                          />
                        </div>
                      </div>
                      {currentVehicle?.lastMileage != null && !(original && currentVehicle.lastSeenAt === original.occurredAt) ? (
                        <p className="text-xs text-muted-foreground" data-shot="last-mileage">
                          {tr("เลขไมล์ครั้งก่อน")} <span className="num">{currentVehicle.lastMileage.toLocaleString(LOCALE)}</span> {tr("กม.")}
                          {currentVehicle.lastSeenAt ? <> ({formatDate(currentVehicle.lastSeenAt)})</> : null}
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <SectionTitle icon={Store}>{tr("ผู้ขาย / ร้านค้า")}</SectionTitle>
                    <div>
                      <Input
                        value={draft.contactName}
                        onChange={(e) => set("contactName", e.target.value)}
                        placeholder={draft.customer?.name ?? tr("ชื่อร้าน / บริษัทที่ซื้อ")}
                        list="supplier-names"
                        aria-label={tr("ชื่อผู้ขาย")}
                        className="h-9"
                      />
                      <datalist id="supplier-names">
                        {suppliers.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </div>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input value={draft.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder={draft.customer?.phone ?? tr("เบอร์โทร")} inputMode="tel" className="pl-8" aria-label={tr("เบอร์โทรผู้ขาย")} />
                    </div>
                    <div>
                      <FieldLabel hint={tr("ไม่บังคับ")}>{tr("เชื่อมกับรายชื่อผู้ติดต่อ")}</FieldLabel>
                      <CustomerPicker value={draft.customer} onChange={setCustomer} onCreate={(typed) => setNewCustomer({ open: true, typed })} placeholder={tr("ค้นหาจากรายชื่อ")} />
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>

          <Card className="shrink-0 gap-3.5 py-4">
            <div className="space-y-3.5 px-4">
              <div>
                <FieldLabel>{tr("วิธีชำระเงิน")}</FieldLabel>
                <Segmented
                  ariaLabel={tr("วิธีชำระเงิน")}
                  value={draft.paymentMethod === "other" ? "cash" : draft.paymentMethod}
                  onChange={(m) => {
                    setDraft((d) => ({ ...d, paymentMethod: m, paymentStatus: m === "credit" ? "unpaid" : "paid" }));
                    if (m !== "cash") setReceived(null);
                  }}
                  options={METHOD_OPTIONS}
                  layout="stacked"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-[13px] font-medium text-muted-foreground">{tr("สถานะ")}</span>
                <Segmented ariaLabel={tr("สถานะการชำระ")} value={draft.paymentStatus} onChange={(v) => set("paymentStatus", v)} options={STATUS_OPTIONS} size="sm" className="flex-1" />
              </div>
              {showVat ? (
                <div>
                  <FieldLabel>{tr("ภาษีมูลค่าเพิ่ม")}</FieldLabel>
                  <Segmented ariaLabel={tr("ภาษีมูลค่าเพิ่ม")} value={draft.vatMode} onChange={(v) => set("vatMode", v)} options={vatOptions(draft.vatRate)} size="sm" />
                </div>
              ) : null}
            </div>
          </Card>

          <Card ref={totalsRef} className="shrink-0 gap-0 py-0">
            <dl className="space-y-2 px-4 pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{tr("รวมเป็นเงิน")}</dt>
                <dd className="num font-medium">{formatBaht(totals.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{tr("ส่วนลดท้ายบิล")}</dt>
                <dd className="w-36">
                  <MoneyInput value={draft.discount} onChange={(v) => set("discount", v ?? 0)} className={cn("h-8", draft.discount === 0 && "text-muted-foreground")} aria-label={tr("ส่วนลดท้ายบิล")} />
                </dd>
              </div>
              {draft.vatMode !== "none" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{tr("ราคาก่อน VAT")}</dt>
                    <dd className="num">{formatBaht(totals.beforeVat)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">VAT {draft.vatRate}%</dt>
                    <dd className="num">{formatBaht(totals.vatAmount)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            <div className="mx-4 mt-3 flex items-end justify-between gap-3 border-t border-dashed pt-3">
              <span className="pb-1 text-sm font-medium">{tr("ยอดสุทธิ")}</span>
              <span className="num text-[2rem] leading-none font-bold tracking-tight" data-shot="bill-total">
                {formatBaht(totals.total)}
              </span>
            </div>

            {isSale && draft.paymentMethod === "cash" && totals.total > 0 ? (
              <div className="mx-4 mt-3 space-y-1.5 rounded-lg bg-muted/60 px-3 py-2.5" data-shot="cash-helper">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-sm text-muted-foreground">{tr("รับเงินมา")}</span>
                  <div className="min-w-0 flex-1">
                    <MoneyInput value={received} allowEmpty onChange={setReceived} placeholder="0.00" className="h-8 bg-background" aria-label={tr("รับเงิน")} data-shot="cash-received" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 pl-[4.5rem]">
                  {quickCash(totals.total).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setReceived(v)}
                      className={cn(
                        "num rounded-md border bg-background px-1.5 py-0.5 text-xs transition-colors hover:border-primary/40 hover:text-primary",
                        received === v && "border-primary/50 text-primary",
                      )}
                    >
                      {v === totals.total ? tr("พอดี") : formatBaht(v).replace(".00", "")}
                    </button>
                  ))}
                </div>
                {change !== null ? (
                  <div className="flex items-baseline justify-between gap-3 border-t border-foreground/10 pt-1.5">
                    <span className="text-sm text-muted-foreground">{change >= 0 ? tr("เงินทอน") : tr("ยังขาดอีก")}</span>
                    <span className={cn("num text-lg font-semibold", change >= 0 ? "text-income" : "text-destructive")} data-shot="cash-change">
                      {formatBaht(Math.abs(change))}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mx-4 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="space-y-2 p-4">
              <Button type="button" className="h-11 w-full text-base" onClick={() => submit(false)} disabled={save.isPending} data-shot="save-bill">
                {save.isPending ? <Spinner /> : <Save />}
                {mode === "edit" ? tr("บันทึกการแก้ไข") : tr("บันทึก")}
                <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground/80">{modKey}S</Kbd>
              </Button>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Button type="button" variant="outline" className="h-10" onClick={() => submit(true)} disabled={save.isPending} data-shot="save-print">
                  <Printer /> {tr("บันทึกและพิมพ์")}
                </Button>
                <Button type="button" variant="ghost" className="h-10 text-muted-foreground" onClick={cancel} disabled={save.isPending}>
                  {tr("ยกเลิก")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Narrow screens: keep the total and the save button in reach */}
      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-2.5 backdrop-blur transition-opacity md:-mx-6 md:px-6 @min-[60rem]/bill:hidden",
          totalsVisible && "pointer-events-none opacity-0",
        )}
        aria-hidden={totalsVisible || undefined}
      >
        <div className="leading-tight">
          <div className="text-xs text-muted-foreground">{tr("ยอดสุทธิ · {0} รายการ", draft.lines.length)}</div>
          <div className="num text-xl font-bold">{formatBaht(totals.total)}</div>
        </div>
        <Button type="button" className="h-10 px-5" onClick={() => submit(false)} disabled={save.isPending}>
          {save.isPending ? <Spinner /> : <Save />}
          {mode === "edit" ? tr("บันทึกการแก้ไข") : tr("บันทึก")}
        </Button>
      </div>

      <CustomerFormDialog
        open={newCustomer.open}
        onOpenChange={(open) => setNewCustomer((s) => ({ ...s, open }))}
        defaultValues={/^[\d\s\-+()]+$/.test(newCustomer.typed) ? { phone: newCustomer.typed } : { name: newCustomer.typed }}
        onSaved={onCustomerCreated}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        onOpenChange={(o) => !o && setLeaveTo(null)}
        title={mode === "edit" ? tr("ทิ้งการแก้ไขที่ยังไม่บันทึก?") : tr("ทิ้งบิลที่ยังไม่บันทึก?")}
        description={tr("ข้อมูลที่กรอกไว้ยังไม่ได้บันทึก และจะหายไปถ้าออกจากหน้านี้")}
        confirmText={tr("ออกโดยไม่บันทึก")}
        cancelText={tr("กลับไปกรอกต่อ")}
        destructive
        onConfirm={() => {
          savedRef.current = true;
          const to = leaveTo;
          setLeaveTo(null);
          if (to) router.push(to);
        }}
      />
    </div>
  );
}
