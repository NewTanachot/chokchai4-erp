"use client";
/**
 * /transactions/ — every sale and purchase bill, with type tabs, date presets, search and filters.
 * The URL is the source of truth for the filters (?type=&range=|from=&to=&q=&paymentStatus=&customerId=&by=&void=1),
 * so "back" from a bill returns to the same list and other screens can deep-link into it.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Ban, ChevronRight, ClipboardList, Clock3, RotateCcw, Search, ShoppingBag, ShoppingCart, TrendingDown, TrendingUp, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAYMENT_METHOD_LABELS, type PaymentStatus, type TransactionListQuery, type TransactionListResult, type TransactionSummary, type TransactionType } from "@shared/contract";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { AUTH_QUERY_KEY, useAuth } from "@/lib/auth";
import { LOCALE, tr } from "@/lib/i18n";
import { fetchFirst } from "@/lib/paging";
import { formatBaht, formatDate, formatTime, type Range } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebounced } from "./hooks";
import { amountTone, PaymentBadge, txHref, TypeBadge, VoidBadge } from "./labels";
import { formatRangeLabel, isRangePreset, matchPreset, presetRange, RangeFilter, type RangePreset } from "./range-filter";
import { Segmented } from "./payment-fields";

const PAGE = 50;

type Tab = "all" | TransactionType;
type PayFilter = "any" | PaymentStatus;

interface Filters {
  tab: Tab;
  preset: RangePreset;
  range: Range | null;
  q: string;
  pay: PayFilter;
  customerId: string | null;
  /** Bills created by this user id. */
  createdBy: string | null;
  showVoid: boolean;
}

const ANYONE = "__anyone__";

function num(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readFilters(sp: URLSearchParams, now: number): Filters {
  const type = sp.get("type");
  const tab: Tab = type === "sale" || type === "purchase" ? type : "all";
  const ps = sp.get("paymentStatus");
  const pay: PayFilter = ps === "paid" || ps === "unpaid" ? ps : "any";
  const customerId = sp.get("customerId") || null;
  const createdBy = sp.get("by") || null;
  const q = sp.get("q") ?? "";
  const from = num(sp.get("from"));
  const to = num(sp.get("to"));
  const rangeKey = sp.get("range");
  let preset: RangePreset;
  let range: Range | null;
  if (from !== null && to !== null && to > from) {
    const match = matchPreset({ from, to }, now);
    preset = match ?? "custom";
    range = { from, to };
  } else if (isRangePreset(rangeKey)) {
    preset = rangeKey;
    range = presetRange(rangeKey, now);
  } else {
    // Looking for something specific (a customer, unpaid bills, a search) -> all time; else this month.
    preset = customerId || pay !== "any" || q ? "all" : "month";
    range = presetRange(preset, now);
  }
  return { tab, preset, range, q, pay, customerId, createdBy, showVoid: sp.get("void") === "1" };
}

function writeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tab !== "all") p.set("type", f.tab);
  if (f.preset === "custom" && f.range) {
    p.set("from", String(f.range.from));
    p.set("to", String(f.range.to));
  } else p.set("range", f.preset);
  if (f.q) p.set("q", f.q);
  if (f.pay !== "any") p.set("paymentStatus", f.pay);
  if (f.customerId) p.set("customerId", f.customerId);
  if (f.createdBy) p.set("by", f.createdBy);
  if (f.showVoid) p.set("void", "1");
  return p.toString();
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/**
 * Columns: narrow = two-line card rows; @2xl = date | doc(+type) | who(+plate) | items | total | payment;
 * @5xl = separate type (tab "ทั้งหมด") and plate (not for purchases) columns.
 */
const GRID_BASE = cn(
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1",
  "@2xl:grid-cols-[5.5rem_7.5rem_minmax(0,1.1fr)_minmax(0,1fr)_7.5rem_7rem] @2xl:gap-x-4",
);
const GRID: Record<Tab, string> = {
  all: cn(GRID_BASE, "@5xl:grid-cols-[6rem_7.25rem_3.5rem_minmax(0,1.15fr)_8rem_minmax(0,1fr)_8rem_7.5rem]"),
  sale: cn(GRID_BASE, "@5xl:grid-cols-[6rem_7.25rem_minmax(0,1.15fr)_8.5rem_minmax(0,1fr)_8rem_7.5rem]"),
  purchase: cn(GRID_BASE, "@5xl:grid-cols-[6rem_7.25rem_minmax(0,1.1fr)_minmax(0,1.2fr)_8rem_7.5rem]"),
};
const WHO_HEADER: Record<Tab, string> = { all: tr("ลูกค้า / ผู้ขาย"), sale: tr("ลูกค้า"), purchase: tr("ผู้ขาย") };

function ListHeader({ tab }: { tab: Tab }) {
  return (
    <div className={cn(GRID[tab], "hidden border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground @2xl:grid")}>
      <span>{tr("วันที่ / เวลา")}</span>
      <span>{tr("เลขที่บิล")}</span>
      {tab === "all" ? <span className="hidden @5xl:block">{tr("ประเภท")}</span> : null}
      <span>{WHO_HEADER[tab]}</span>
      {tab !== "purchase" ? <span className="hidden @5xl:block">{tr("ทะเบียนรถ")}</span> : null}
      <span>{tr("รายการ")}</span>
      <span className="text-right">{tr("ยอดรวม")}</span>
      <span>{tr("การชำระ")}</span>
    </div>
  );
}

function whoOf(t: TransactionSummary): { name: string; muted: boolean } {
  if (t.displayName) return { name: t.displayName, muted: false };
  return { name: t.type === "sale" ? tr("ลูกค้าทั่วไป") : tr("ไม่ระบุผู้ขาย"), muted: true };
}

function Row({ t, tab }: { t: TransactionSummary; tab: Tab }) {
  const showType = tab === "all";
  const router = useRouter();
  const href = txHref.view(t.id);
  const isVoid = t.status === "void";
  const who = whoOf(t);
  const payment = isVoid ? (
    <VoidBadge />
  ) : (
    <div className="flex flex-col items-start gap-0.5">
      <PaymentBadge status={t.paymentStatus} />
      <span className="pl-0.5 text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[t.paymentMethod]}</span>
    </div>
  );
  const amount = (
    <span className={cn("num font-semibold", isVoid ? "text-muted-foreground line-through decoration-1" : amountTone(t.type))}>{formatBaht(t.total)}</span>
  );

  return (
    <div
      role="link"
      tabIndex={0}
      data-shot="tx-row"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className={cn(
        GRID[tab],
        "group cursor-pointer px-4 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60",
        isVoid && "bg-muted/25",
      )}
    >
      {/* date (wide) */}
      <div className={cn("hidden leading-tight @2xl:block", isVoid && "opacity-60")}>
        <div className="text-sm">{formatDate(t.occurredAt)}</div>
        <div className="num mt-0.5 text-xs text-muted-foreground">{tr("{0} น.", formatTime(t.occurredAt))}</div>
      </div>

      {/* doc no (+ type badge below until the type column appears) */}
      <div className={cn("hidden min-w-0 @2xl:block", isVoid && "opacity-60")}>
        <Link href={href} className={cn("num block w-fit text-sm font-semibold hover:text-primary hover:underline hover:underline-offset-3", isVoid && "line-through")}>
          {t.docNo}
        </Link>
        {showType ? <TypeBadge type={t.type} className="mt-1 h-5 px-1.5 text-xs @5xl:hidden" /> : null}
        {t.createdByName ? <div className="mt-0.5 truncate text-xs text-muted-foreground" title={tr("ผู้บันทึก")}>{tr("โดย {0}", t.createdByName)}</div> : null}
      </div>
      {showType ? (
        <div className={cn("hidden @5xl:block", isVoid && "opacity-60")}>
          <TypeBadge type={t.type} />
        </div>
      ) : null}

      {/* who (+ plate below until the plate column appears) — on narrow rows also the doc/date line */}
      <div className={cn("min-w-0", isVoid && "opacity-60")}>
        <div className="flex min-w-0 items-center gap-2">
          {showType ? <TypeBadge type={t.type} className="h-5 shrink-0 px-1.5 text-xs @2xl:hidden" /> : null}
          <span className={cn("line-clamp-2 font-medium break-words", who.muted && "font-normal text-muted-foreground")}>{who.name}</span>
        </div>
        {t.vehiclePlate ? <div className={cn("truncate text-xs text-muted-foreground", tab !== "purchase" && "@5xl:hidden")}>{tr("ทะเบียน {0}", t.vehiclePlate)}</div> : null}
        <div className="num truncate text-xs text-muted-foreground @2xl:hidden">
          <span className={cn(isVoid && "line-through")}>{t.docNo}</span> {tr("· {0} {1} น.{2}", formatDate(t.occurredAt), formatTime(t.occurredAt), t.createdByName ? tr(" · โดย {0}", t.createdByName) : "")}
        </div>
      </div>

      {/* plate (wide) */}
      {tab !== "purchase" ? (
        <div className={cn("hidden min-w-0 @5xl:block", isVoid && "opacity-60")}>
          {t.vehiclePlate ? <span className="line-clamp-2 text-sm break-words">{t.vehiclePlate}</span> : <span className="text-sm text-muted-foreground/60">—</span>}
        </div>
      ) : null}

      {/* items */}
      <div className={cn("col-span-full min-w-0 @2xl:col-span-1", isVoid && "opacity-60")}>
        <p className="line-clamp-2 text-sm leading-snug text-foreground/85" title={t.itemsPreview}>
          {t.itemsPreview || <span className="text-muted-foreground">—</span>}
        </p>
        {t.itemCount > 1 ? <span className="text-xs text-muted-foreground">{tr("{0} รายการ", t.itemCount)}</span> : null}
      </div>

      {/* total */}
      <div className="col-start-2 row-start-1 text-right @2xl:col-auto @2xl:row-auto">{amount}</div>

      {/* payment */}
      <div className="col-span-full flex items-center justify-between gap-2 @2xl:col-span-1 @2xl:block">
        {payment}
        <ChevronRight className="size-4 text-muted-foreground/50 @2xl:hidden" />
      </div>
    </div>
  );
}

function RowsSkeleton({ tab }: { tab: Tab }) {
  return (
    <div className="divide-y">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={cn(GRID[tab], "px-4 py-3.5")}>
          <div className="hidden space-y-1.5 @2xl:block">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="hidden h-4 w-24 @2xl:block" />
          {tab === "all" ? <Skeleton className="hidden h-6 w-10 @5xl:block" /> : null}
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-24 @2xl:hidden" />
          </div>
          {tab !== "purchase" ? <Skeleton className="hidden h-4 w-24 @5xl:block" /> : null}
          <Skeleton className="col-span-full h-4 w-4/5 @2xl:col-span-1" />
          <Skeleton className="col-start-2 row-start-1 ml-auto h-4 w-20 @2xl:col-auto @2xl:row-auto" />
          <Skeleton className="hidden h-6 w-20 @2xl:block" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------------------------

function Tile({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  onClick,
  active,
  shot,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  active?: boolean;
  shot?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={cn("size-4", tone)} />
        {label}
      </div>
      <div className={cn("num mt-1 text-2xl leading-tight font-semibold tracking-tight", tone)}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </>
  );
  const cls = "min-w-0 rounded-xl border bg-card px-4 py-3 text-left shadow-xs";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, "transition-colors hover:border-foreground/20 hover:bg-muted/30", active && "border-warning/60 bg-warning/8")}
      data-shot={shot}
    >
      {body}
    </button>
  ) : (
    <div className={cls} data-shot={shot}>
      {body}
    </div>
  );
}

function Summary({ tab, data, pay, onUnpaid }: { tab: Tab; data?: TransactionListResult; pay: PayFilter; onUnpaid: () => void }) {
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[5.25rem] rounded-xl" />
        ))}
      </div>
    );
  }
  const s = data.sums;
  const bills = (n: number) => tr("{0} บิล", n.toLocaleString(LOCALE));
  const avg = (total: number, n: number) => (n ? tr("เฉลี่ย {0} / บิล", formatBaht(Math.round(total / n))) : tr("ยังไม่มีบิล"));
  const unpaid = tab === "sale" ? s.saleUnpaidTotal : tab === "purchase" ? s.purchaseUnpaidTotal : s.unpaidTotal;
  const unpaidLabel = tab === "sale" ? tr("ค้างรับ (ลูกค้ายังไม่จ่าย)") : tab === "purchase" ? tr("ค้างจ่าย (ร้านยังไม่จ่าย)") : tr("ค้างชำระ");
  const unpaidSub =
    tab === "all" && (s.saleUnpaidTotal || s.purchaseUnpaidTotal) ? (
      <span className="num">
        {tr("ค้างรับ {0} · ค้างจ่าย {1}", formatBaht(s.saleUnpaidTotal), formatBaht(s.purchaseUnpaidTotal))}
      </span>
    ) : pay === "unpaid" ? (
      tr("กำลังแสดงเฉพาะบิลค้างชำระ")
    ) : unpaid ? (
      tr("กดเพื่อดูเฉพาะบิลค้างชำระ")
    ) : (
      tr("ไม่มียอดค้าง")
    );

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tab !== "purchase" ? (
        <Tile label={tab === "sale" ? tr("ยอดขาย") : tr("รายรับ (ขาย)")} value={formatBaht(s.saleTotal)} sub={tab === "sale" ? `${bills(s.saleCount)} · ${avg(s.saleTotal, s.saleCount)}` : bills(s.saleCount)} tone={s.saleTotal ? "text-income" : undefined} icon={TrendingUp} shot="sum-sale" />
      ) : null}
      {tab !== "sale" ? (
        <Tile label={tab === "purchase" ? tr("ยอดซื้อ") : tr("รายจ่าย (ซื้อ)")} value={formatBaht(s.purchaseTotal)} sub={tab === "purchase" ? `${bills(s.purchaseCount)} · ${avg(s.purchaseTotal, s.purchaseCount)}` : bills(s.purchaseCount)} tone={s.purchaseTotal ? "text-expense" : undefined} icon={TrendingDown} shot="sum-purchase" />
      ) : null}
      <Tile
        label={unpaidLabel}
        value={formatBaht(unpaid)}
        sub={unpaidSub}
        tone={unpaid ? "text-warning-foreground dark:text-warning" : undefined}
        icon={Clock3}
        onClick={unpaid || pay === "unpaid" ? onUnpaid : undefined}
        active={pay === "unpaid"}
        shot="sum-unpaid"
      />
      {tab !== "all" ? (
        <Tile
          label={tr("จำนวนบิล")}
          value={(tab === "sale" ? s.saleCount : s.purchaseCount).toLocaleString(LOCALE)}
          sub={s.voidCount ? tr("ไม่รวมบิลที่ยกเลิก {0} บิล", s.voidCount) : tr("ไม่รวมบิลที่ยกเลิก")}
          icon={ClipboardList}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "all", label: tr("ทั้งหมด") },
  { value: "sale", label: tr("ขาย") },
  { value: "purchase", label: tr("ซื้อ") },
];

const SUMMARY_TITLES: Record<RangePreset, string> = {
  today: tr("สรุปวันนี้"),
  yesterday: tr("สรุปเมื่อวาน"),
  "7d": tr("สรุป 7 วันล่าสุด"),
  month: tr("สรุปเดือนนี้"),
  all: tr("สรุปทั้งหมด"),
  custom: tr("สรุปช่วงที่เลือก"),
};

const PAY_OPTIONS: { value: PayFilter; label: string }[] = [
  { value: "any", label: tr("ทุกสถานะ") },
  { value: "paid", label: tr("ชำระแล้ว") },
  { value: "unpaid", label: tr("ค้างชำระ") },
];

export function TransactionListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const spKey = sp.toString();
  // Preset ranges are resolved when the URL changes (stable query keys; a new day starts on the next change).
  const f = useMemo(() => readFilters(new URLSearchParams(spKey), Date.now()), [spKey]);

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = writeFilters({ ...f, ...patch });
      // `null` state (not Next's own) so Next syncs useSearchParams with the new URL.
      if (next !== spKey) window.history.replaceState(null, "", `${window.location.pathname}?${next}`);
    },
    [f, spKey],
  );

  // Search box: local text, debounced into the URL.
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search.trim(), 250);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dq !== f.q) setFilters({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  useEffect(() => {
    if (f.q !== dq) setSearch(f.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.q]);

  const [limit, setLimit] = useState(PAGE);
  const filterKey = writeFilters(f);
  useEffect(() => setLimit(PAGE), [filterKey]);

  const { can } = useAuth();
  const canSeeTotals = can("reports.view");
  const status = useQuery({ queryKey: AUTH_QUERY_KEY, queryFn: () => api.auth.status(), staleTime: Infinity });
  const query: TransactionListQuery = {
    type: f.tab === "all" ? undefined : f.tab,
    status: f.showVoid ? undefined : "completed",
    paymentStatus: f.pay === "any" ? undefined : f.pay,
    customerId: f.customerId ?? undefined,
    createdBy: f.createdBy ?? undefined,
    from: f.range?.from,
    to: f.range?.to,
    search: f.q || undefined,
    limit,
    offset: 0,
  };
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["transactions", "list", query],
    queryFn: () => fetchFirst(limit, (limit, offset) => api.transactions.list({ ...query, limit, offset })),
    placeholderData: keepPreviousData,
  });

  const customer = useQuery({
    queryKey: ["customers", "get", f.customerId],
    queryFn: () => api.customers.get(f.customerId!),
    enabled: !!f.customerId,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasFilters = !!(f.q || f.pay !== "any" || f.customerId || f.createdBy || f.tab !== "all");
  const noBillsAtAll = !isPending && !isError && total === 0 && !hasFilters && f.preset === "all";
  const rangeText = f.range ? formatRangeLabel(f.range) : tr("ทุกช่วงเวลา");
  const summaryTitle = SUMMARY_TITLES[f.preset];
  const newExtra = f.customerId ? { customerId: f.customerId } : undefined;

  return (
    <>
      <PageHeader
        title={tr("รายการซื้อ-ขาย")}
        description={tr("บิลขายและบิลซื้อทั้งหมดของร้าน — กดที่บิลเพื่อดูรายละเอียด พิมพ์ แก้ไข หรือยกเลิก")}
        actions={
          <>
            {can("purchases.create") ? (
              <Button asChild variant="outline" size="lg" className="h-10 px-3.5">
                <Link href={txHref.new("purchase")} data-shot="list-new-purchase">
                  <ShoppingBag /> {tr("บันทึกการซื้อ")}
                </Link>
              </Button>
            ) : null}
            <Button asChild size="lg" className="h-10 px-4">
              <Link href={txHref.new("sale", newExtra)} data-shot="list-new-sale">
                <ShoppingCart /> {tr("ขายสินค้า / บริการ")}
              </Link>
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={f.tab} onValueChange={(v) => setFilters({ tab: v as Tab })}>
            <TabsList className="h-10 rounded-xl p-1 group-data-horizontal/tabs:h-10">
              {TAB_OPTIONS.map((o) => (
                <TabsTrigger key={o.value} value={o.value} className="h-8 rounded-lg px-4 text-sm" data-shot={`tab-${o.value}`}>
                  {o.value === "sale" ? <ShoppingCart className="text-income" /> : o.value === "purchase" ? <ShoppingBag className="text-chart-5" /> : null}
                  {o.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <RangeFilter
            preset={f.preset}
            range={f.range}
            onPreset={(key) => setFilters({ preset: key, range: presetRange(key) })}
            onCustom={(r) => {
              const match = matchPreset(r);
              setFilters({ preset: match ?? "custom", range: r });
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <InputGroup className="h-10 max-w-lg min-w-60 flex-1 bg-card">
            <InputGroupAddon>{isFetching && !isPending ? <Spinner className="size-4" /> : <Search className="size-4" />}</InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) {
                  e.preventDefault();
                  setSearch("");
                }
                if (e.key === "Enter" && items.length === 1 && dq === search.trim()) router.push(txHref.view(items[0].id));
              }}
              placeholder={tr("ค้นหาเลขที่บิล, ชื่อ, เบอร์โทร, ทะเบียนรถ หรือชื่อสินค้า")}
              aria-label={tr("ค้นหาบิล")}
              className="text-sm"
              data-shot="tx-search"
            />
            {search ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={tr("ล้างคำค้น")}
                  onClick={() => {
                    setSearch("");
                    inputRef.current?.focus();
                  }}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>

          <Segmented ariaLabel={tr("สถานะการชำระ")} value={f.pay} onChange={(v) => setFilters({ pay: v })} options={PAY_OPTIONS} className="w-[17.5rem] shrink-0" />

          <Select value={f.createdBy ?? ANYONE} onValueChange={(v) => setFilters({ createdBy: v === ANYONE ? null : v })}>
            <SelectTrigger className="h-10 w-40 shrink-0" aria-label={tr("ผู้บันทึก")} data-shot="filter-created-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANYONE}>{tr("ผู้บันทึก: ทุกคน")}</SelectItem>
              {(status.data?.users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Switch id="show-void" checked={f.showVoid} onCheckedChange={(v) => setFilters({ showVoid: v })} data-shot="show-void" />
            <Label htmlFor="show-void" className="cursor-pointer text-sm font-normal text-muted-foreground">
              {tr("แสดงบิลที่ยกเลิก")}
            </Label>
          </div>
        </div>

        {f.customerId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{tr("เฉพาะลูกค้า")}</span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card pr-1 pl-3">
              <UserRound className="size-3.5 text-muted-foreground" />
              {customer.data ? (
                <Link href={`/customers/view/?id=${encodeURIComponent(customer.data.id)}`} className="font-medium hover:text-primary hover:underline">
                  {customer.data.name}
                </Link>
              ) : customer.isError ? (
                <span className="text-muted-foreground">{tr("ลูกค้าที่ถูกลบแล้ว")}</span>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
              <Button variant="ghost" size="icon-xs" className="rounded-full text-muted-foreground" aria-label={tr("แสดงทุกลูกค้า")} onClick={() => setFilters({ customerId: null })}>
                <X />
              </Button>
            </span>
          </div>
        ) : null}
      </div>

      {isError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{tr("โหลดรายการบิลไม่สำเร็จ")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RotateCcw /> {tr("ลองใหม่")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : noBillsAtAll ? (
        <Empty className="border bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-14 rounded-2xl bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-7">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle className="text-lg">{tr("ยังไม่มีบิลซื้อ-ขาย")}</EmptyTitle>
            <EmptyDescription>{tr("เริ่มขายสินค้าหรือบริการ หรือบันทึกการซื้อสินค้าเข้าร้าน แล้วบิลจะแสดงที่นี่")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button asChild variant="outline" size="lg" className="h-10 px-4">
              <Link href={txHref.new("purchase")}>
                <ShoppingBag /> {tr("บันทึกการซื้อ")}
              </Link>
            </Button>
            <Button asChild size="lg" className="h-10 px-4">
              <Link href={txHref.new("sale")}>
                <ShoppingCart /> {tr("ขายสินค้า / บริการ")}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">
              {summaryTitle} <span className="num font-normal text-muted-foreground">· {rangeText}</span>
            </h2>
            {f.showVoid && data?.sums.voidCount ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Ban className="size-3.5" /> {tr("ยอดรวมไม่นับบิลที่ยกเลิก ({0} บิล)", data.sums.voidCount)}
              </span>
            ) : null}
          </div>
          {canSeeTotals ? (
            <div className="mb-4">
              <Summary tab={f.tab} data={data} pay={f.pay} onUnpaid={() => setFilters({ pay: f.pay === "unpaid" ? "any" : "unpaid" })} />
            </div>
          ) : null}

          <div className="@container overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-label={tr("รายการบิล")}>
            {isPending || items.length > 0 ? <ListHeader tab={f.tab} /> : null}
            {isPending ? (
              <RowsSkeleton tab={f.tab} />
            ) : items.length === 0 ? (
              <Empty className="py-14">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="size-12 rounded-xl [&_svg:not([class*='size-'])]:size-6">
                    <Search />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">{f.q ? tr("ไม่พบบิลที่ตรงกับ “{0}”", f.q) : tr("ไม่มีบิลตามเงื่อนไขที่เลือก")}</EmptyTitle>
                  <EmptyDescription>
                    {f.range ? <>{tr("ช่วงเวลา {0} ·", rangeText)} </> : null}
                    {tr("ลองค้นด้วยเลขที่บิล ชื่อลูกค้า เบอร์โทร (พิมพ์แค่ตัวเลขก็ได้) ทะเบียนรถ หรือชื่อสินค้า")}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="flex-row flex-wrap justify-center">
                  {f.preset !== "all" ? (
                    <Button variant="outline" size="lg" className="h-10 px-4" onClick={() => setFilters({ preset: "all", range: null })} data-shot="search-all-time">
                      {tr("ค้นหาทุกช่วงเวลา")}
                    </Button>
                  ) : null}
                  {hasFilters || f.showVoid ? (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-10 px-4"
                      onClick={() => {
                        setSearch("");
                        setFilters({ q: "", pay: "any", customerId: null, createdBy: null, tab: "all", showVoid: false });
                      }}
                    >
                      {tr("ล้างตัวกรอง")}
                    </Button>
                  ) : null}
                </EmptyContent>
              </Empty>
            ) : (
              <div className={cn("divide-y transition-opacity", isPlaceholderData && "opacity-60")}>
                {items.map((t) => (
                  <Row key={t.id} t={t} tab={f.tab} />
                ))}
              </div>
            )}
            {items.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                <span>
                  {tr("แสดง {0} จาก {1} บิล", items.length.toLocaleString(LOCALE), total.toLocaleString(LOCALE))}
                </span>
                {items.length < total ? (
                  <Button variant="outline" size="lg" disabled={isFetching} onClick={() => setLimit((l) => l + PAGE)} data-shot="load-more">
                    {isFetching ? <Spinner /> : null} {tr("แสดงเพิ่ม (อีก {0} บิล)", Math.min(PAGE, total - items.length).toLocaleString(LOCALE))}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
