"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChartColumn,
  Clock,
  Layers,
  PiggyBank,
  ReceiptText,
  Scale,
  ShoppingBag,
  Table2,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import type { DailyRow, Summary, TopItemRow } from "@shared/contract";
import { formatQty } from "@shared/money";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { dayRange, formatBaht, formatDateLong, toDateInput, type Range } from "@/lib/format";
import { tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DayTransactionsCard } from "@/components/dashboard/today-transactions";
import { formatDayShort, formatMonthLong, formatMonthShort, formatPercent, formatWeekdayShort, ITEM_TYPE_LABELS } from "./format";
import { MeterList } from "./meter-list";
import { PaymentBreakdown } from "./payment-breakdown";
import { QueryError } from "./query-error";
import { formatRangeLabel, RangePicker } from "./range-picker";
import { bucketize, customRange, dayCount, isPresetKey, presetRange, previousRange, type Bucket, type PresetKey } from "./ranges";
import { SalesPurchaseChart, type ChartPoint } from "./sales-purchase-chart";
import { Delta, StatCard } from "./stat-card";

const DEFAULT_PRESET: PresetKey = "month";
/** Longer ranges are charted / tabulated per month. */
const MAX_DAILY_BUCKETS = 62;

/** Reads ?range=…&from=YYYY-MM-DD&to=YYYY-MM-DD (from/to only for "custom", inclusive). */
function useReportRange() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawPreset = params.get("range");
  const fromParam = params.get("from") ?? "";
  const toParam = params.get("to") ?? "";

  const value = useMemo(() => {
    let preset: PresetKey = isPresetKey(rawPreset) ? rawPreset : DEFAULT_PRESET;
    let range: Range | null = null;
    if (preset === "custom") range = customRange(fromParam, toParam || fromParam);
    if (!range) {
      if (preset === "custom") preset = DEFAULT_PRESET;
      range = presetRange(preset as Exclude<PresetKey, "custom">);
    }
    return { preset, range };
  }, [rawPreset, fromParam, toParam]);

  const go = (qs: string) => router.replace(`${pathname}?${qs}`, { scroll: false });
  return {
    ...value,
    setPreset: (p: Exclude<PresetKey, "custom">) => go(`range=${p}`),
    setCustom: (from: string, to: string) => go(`range=custom&from=${from}&to=${to}`),
  };
}

export function ReportsView() {
  const { preset, range, setPreset, setCustom } = useReportRange();
  const days = dayCount(range);
  const prev = previousRange(preset, range);
  const granularity: "day" | "month" = days > MAX_DAILY_BUCKETS ? "month" : "day";
  const singleDay = days <= 1;
  // Chart / table stop at today: "เดือนนี้" / "ปีนี้" would otherwise end in a row of empty future buckets.
  const endOfToday = dayRange(Date.now()).to;
  const trendRange = range.to > endOfToday && range.from < endOfToday ? { from: range.from, to: endOfToday } : range;

  const drillDown = (b: Bucket) => {
    if (granularity === "day") setCustom(b.key, b.key);
    else {
      const start = new Date(b.start);
      const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      setCustom(toDateInput(start.getTime()), toDateInput(last.getTime()));
    }
  };

  return (
    <div className="@container flex flex-col gap-5">
      <PageHeader title={tr("รายงาน")} description={tr("สรุปรายรับ รายจ่าย กำไร และสินค้าขายดี ตามช่วงเวลาที่เลือก")} className="mb-0" />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <RangePicker preset={preset} range={range} onPreset={setPreset} onCustom={setCustom} />
        {/* A custom range is already spelled out on its button; only add the length. */}
        <div className="text-sm text-muted-foreground" data-shot="range-label">
          {preset === "custom" ? (
            days > 1 ? <span className="num">{tr("รวม {0} วัน", days)}</span> : null
          ) : (
            <>
              <span className="font-medium text-foreground">{formatRangeLabel(range)}</span>
              {days > 1 ? <span className="num"> {tr("· {0} วัน", days)}</span> : null}
            </>
          )}
        </div>
      </div>

      <SummaryGrid range={range} prev={prev.range} prevLabel={prev.label} />

      {singleDay ? (
        <DayTransactionsCard
          range={range}
          title={tr("รายการของ{0}", formatDateLong(range.from))}
          emptyTitle={tr("ไม่มีรายการในวันนี้")}
          emptyHint={tr("ยังไม่มีการขายหรือซื้อในวันที่เลือก")}
        />
      ) : (
        <TrendChartCard range={trendRange} granularity={granularity} />
      )}

      <div className="grid items-start gap-5 @4xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          {singleDay ? null : <DailyTableCard range={trendRange} granularity={granularity} onPick={drillDown} />}
          <TopSellingCard range={range} />
          {singleDay ? <TopPurchasesCard range={range} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <PaymentCard range={range} />
          <RevenueSplitCard range={range} />
          <SalesByUserCard range={range} />
          {singleDay ? null : <TopPurchasesCard range={range} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary cards

function useSummary(range: Range) {
  return useQuery({ queryKey: ["reports", "summary", range], queryFn: () => api.reports.summary(range) });
}

function SummaryGrid({ range, prev, prevLabel }: { range: Range; prev: Range; prevLabel: string }) {
  const cur = useSummary(range);
  const before = useSummary(prev);
  if (cur.error) {
    return (
      <Card className="py-0">
        <QueryError error={cur.error} onRetry={() => void cur.refetch()} />
      </Card>
    );
  }
  const s = cur.data;
  const p = before.data;
  const loading = !s;
  const beforeVat = s ? s.sales.total - s.sales.vatAmount : 0;
  const delta = (get: (x: Summary) => number, upIsGood = true) =>
    s && p ? <Delta current={get(s)} previous={get(p)} upIsGood={upIsGood} label={prevLabel} /> : null;

  return (
    <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @2xl:grid-cols-3" data-shot="report-summary">
      <StatCard
        label={tr("รายรับ (ยอดขาย)")}
        icon={ArrowDownLeft}
        tone="income"
        loading={loading}
        value={s ? formatBaht(s.sales.total) : null}
        valueClassName="text-income"
        sub={s ? tr("ขาย {0} บิล{1}", s.sales.count, s.sales.vatAmount > 0 ? ` · VAT ${formatBaht(s.sales.vatAmount)}` : "") : null}
        delta={delta((x) => x.sales.total)}
      />
      <StatCard
        label={tr("รายจ่าย (ซื้อเข้า)")}
        icon={ArrowUpRight}
        tone="expense"
        loading={loading}
        value={s ? formatBaht(s.purchases.total) : null}
        valueClassName="text-expense"
        sub={s ? tr("ซื้อ {0} บิล", s.purchases.count) : null}
        delta={delta((x) => x.purchases.total, false)}
      />
      <StatCard
        label={tr("สุทธิ")}
        icon={Scale}
        tone="primary"
        loading={loading}
        value={s ? formatBaht(s.net) : null}
        valueClassName={cn(s && s.net < 0 && "text-expense")}
        sub={tr("รายรับ − รายจ่าย")}
        delta={delta((x) => x.net)}
      />
      <StatCard
        label={tr("กำไรขั้นต้น")}
        icon={PiggyBank}
        tone="primary"
        loading={loading}
        value={s ? formatBaht(s.grossProfit) : null}
        valueClassName={cn(s && s.grossProfit < 0 && "text-expense")}
        sub={s ? (beforeVat > 0 ? tr("อัตรากำไร {0} (ไม่รวม VAT)", formatPercent(s.grossProfit / beforeVat)) : tr("ยอดขาย (ไม่รวม VAT) − ต้นทุนสินค้า")) : null}
        delta={delta((x) => x.grossProfit)}
      />
      <StatCard
        label={tr("จำนวนบิล")}
        icon={ReceiptText}
        tone="neutral"
        loading={loading}
        value={
          s ? (
            <>
              {s.sales.count + s.purchases.count} <span className="text-base font-medium text-muted-foreground">{trc("unit", "บิล")}</span>
            </>
          ) : null
        }
        sub={s ? tr("ขาย {0} · ซื้อ {1}{2}", s.sales.count, s.purchases.count, s.voidCount > 0 ? tr(" · ยกเลิก {0}", s.voidCount) : "") : null}
        delta={
          s && s.sales.count > 0 ? (
            <div className="text-xs text-muted-foreground">
              {tr("เฉลี่ยบิลขายละ")} <span className="num font-medium text-foreground">{formatBaht(Math.round(s.sales.total / s.sales.count))}</span>
            </div>
          ) : null
        }
      />
      <StatCard
        label={tr("ค้างชำระ (ขายเชื่อ)")}
        icon={Clock}
        tone="warning"
        loading={loading}
        value={s ? formatBaht(s.sales.unpaidTotal) : null}
        sub={s ? (s.sales.unpaidCount > 0 ? tr("{0} บิลในช่วงนี้ยังไม่ได้รับเงิน", s.sales.unpaidCount) : tr("ไม่มีบิลค้างชำระในช่วงนี้")) : null}
        delta={
          s && s.purchases.unpaidTotal > 0 ? (
            <div className="text-xs text-muted-foreground">
              {tr("ค้างจ่ายผู้ขาย")} <span className="num font-medium text-foreground">{formatBaht(s.purchases.unpaidTotal)}</span> {tr("({0} บิล)", s.purchases.unpaidCount)}
            </div>
          ) : null
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend chart + table

function useBuckets(range: Range, granularity: "day" | "month") {
  const q = useQuery({ queryKey: ["reports", "daily", range], queryFn: () => api.reports.daily(range) });
  const buckets = useMemo(() => (q.data ? bucketize(q.data as DailyRow[], granularity) : []), [q.data, granularity]);
  return { q, buckets };
}

function TrendChartCard({ range, granularity }: { range: Range; granularity: "day" | "month" }) {
  const { q, buckets } = useBuckets(range, granularity);
  const data: ChartPoint[] = buckets.map((b) => ({
    key: b.key,
    label: granularity === "day" ? formatDayShort(b.start) : formatMonthShort(b.start),
    title: granularity === "day" ? formatDateLong(b.start) : formatMonthLong(b.start),
    sales: b.salesTotal,
    purchases: b.purchasesTotal,
  }));
  return (
    <Card className="gap-3" data-shot="report-chart">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ChartColumn className="size-[18px] text-muted-foreground" /> {granularity === "day" ? tr("ยอดขาย-ซื้อรายวัน") : tr("ยอดขาย-ซื้อรายเดือน")}
        </CardTitle>
        <CardDescription>{tr("แท่งซ้าย = ขาย (รายรับ) · แท่งขวา = ซื้อ (รายจ่าย) · ชี้ที่แท่งเพื่อดูยอด")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <SalesPurchaseChart data={data} />
        )}
      </CardContent>
    </Card>
  );
}

function Money({ v, tone }: { v: number; tone?: "income" | "expense" | "net" }) {
  if (v === 0) return <span className="text-muted-foreground/70">–</span>;
  const cls = tone === "net" ? (v < 0 ? "text-expense" : "") : "";
  return <span className={cls}>{formatBaht(v)}</span>;
}

function DailyTableCard({ range, granularity, onPick }: { range: Range; granularity: "day" | "month"; onPick: (b: Bucket) => void }) {
  const { q, buckets } = useBuckets(range, granularity);
  const todayKey = toDateInput(Date.now());
  const totals = buckets.reduce(
    (t, b) => ({ sales: t.sales + b.salesTotal, purchases: t.purchases + b.purchasesTotal, net: t.net + b.net, sc: t.sc + b.salesCount }),
    { sales: 0, purchases: 0, net: 0, sc: 0 },
  );
  return (
    <Card className="gap-0 pb-0" data-shot="report-table">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Table2 className="size-[18px] text-muted-foreground" /> {granularity === "day" ? tr("สรุปรายวัน") : tr("สรุปรายเดือน")}
        </CardTitle>
        <CardDescription>{tr("กดที่{0}เพื่อดูรายละเอียด", granularity === "day" ? tr("วันที่") : tr("เดือน"))}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : (
          <Table className="num">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">{granularity === "day" ? tr("วันที่") : tr("เดือน")}</TableHead>
                <TableHead className="text-right">{tr("บิลขาย")}</TableHead>
                <TableHead className="text-right">{tr("ขาย")}</TableHead>
                <TableHead className="text-right">{tr("ซื้อ")}</TableHead>
                <TableHead className="pr-4 text-right">{tr("สุทธิ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => {
                const empty = b.salesCount === 0 && b.purchasesCount === 0;
                return (
                  <TableRow key={b.key} className={cn(empty && "text-muted-foreground")}>
                    <TableCell className="pl-4">
                      <button
                        type="button"
                        onClick={() => onPick(b)}
                        className="inline-flex items-center gap-2 rounded-md text-left font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {granularity === "day" ? (
                          <>
                            <span className="w-8 text-muted-foreground">{formatWeekdayShort(b.start)}</span>
                            {formatDayShort(b.start)}
                          </>
                        ) : (
                          formatMonthLong(b.start)
                        )}
                      </button>
                      {granularity === "day" && b.key === todayKey ? (
                        <Badge variant="secondary" className="ml-2">
                          {tr("วันนี้")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{b.salesCount || <span className="text-muted-foreground/70">–</span>}</TableCell>
                    <TableCell className="text-right">
                      <Money v={b.salesTotal} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money v={b.purchasesTotal} />
                    </TableCell>
                    <TableCell className="pr-4 text-right font-medium">
                      <Money v={b.net} tone="net" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="pl-4 font-semibold">{tr("รวม")}</TableCell>
                <TableCell className="text-right font-semibold">{totals.sc}</TableCell>
                <TableCell className="text-right font-semibold text-income">{formatBaht(totals.sales)}</TableCell>
                <TableCell className="text-right font-semibold text-expense">{formatBaht(totals.purchases)}</TableCell>
                <TableCell className={cn("pr-4 text-right font-semibold", totals.net < 0 && "text-expense")}>{formatBaht(totals.net)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top items

function useTopItems(range: Range, type: "sale" | "purchase", itemType?: "product" | "service") {
  const query = { from: range.from, to: range.to, type, itemType, limit: 10 };
  return useQuery({ queryKey: ["reports", "topItems", query], queryFn: () => api.reports.topItems(query) });
}

/** "ขาย 4 เส้น · 2 บิล": one whole template per verb (sold / bought / done). */
const TOP_SUB = {
  sold: (qty: string, unit: string, bills: number) => tr("ขาย {0}{1} · {2} บิล", qty, unit, bills),
  bought: (qty: string, unit: string, bills: number) => tr("ซื้อ {0}{1} · {2} บิล", qty, unit, bills),
  done: (qty: string, unit: string, bills: number) => tr("ทำ {0}{1} · {2} บิล", qty, unit, bills),
};

function TopList({
  q,
  verb,
  color,
  emptyText,
}: {
  q: ReturnType<typeof useTopItems>;
  verb: keyof typeof TOP_SUB;
  color: string;
  emptyText: string;
}) {
  if (q.error) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (q.data.length === 0) return <p className="rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const max = q.data[0]?.total ?? 0;
  return (
    <MeterList
      color={color}
      rows={q.data.map((r: TopItemRow, i) => ({
        key: `${r.itemType}:${r.refId ?? r.name}`,
        rank: i + 1,
        label: r.name,
        sub: TOP_SUB[verb](formatQty(r.qty), r.unit ? ` ${r.unit}` : "", r.billCount),
        value: formatBaht(r.total),
        ratio: max > 0 ? r.total / max : 0,
      }))}
    />
  );
}

function TopSellingCard({ range }: { range: Range }) {
  const products = useTopItems(range, "sale", "product");
  const services = useTopItems(range, "sale", "service");
  return (
    <Card data-shot="report-top">
      <Tabs defaultValue="product" className="gap-4">
        <CardHeader className="gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Trophy className="size-[18px] text-muted-foreground" /> {tr("ขายดี 10 อันดับ")}
          </CardTitle>
          <TabsList className="h-9 w-full">
            <TabsTrigger value="product" data-shot="top-products">
              {tr("สินค้าขายดี")}
            </TabsTrigger>
            <TabsTrigger value="service" data-shot="top-services">
              {tr("บริการยอดนิยม")}
            </TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="product">
            <TopList q={products} verb="sold" color="var(--chart-2)" emptyText={tr("ยังไม่มีการขายสินค้าในช่วงนี้")} />
          </TabsContent>
          <TabsContent value="service">
            <TopList q={services} verb="done" color="var(--chart-2)" emptyText={tr("ยังไม่มีงานบริการในช่วงนี้")} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

function TopPurchasesCard({ range }: { range: Range }) {
  const q = useTopItems(range, "purchase");
  return (
    <Card data-shot="report-purchases">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ShoppingBag className="size-[18px] text-muted-foreground" /> {tr("ซื้อเข้ามากที่สุด")}
        </CardTitle>
        <CardDescription>{tr("รายการที่ใช้เงินซื้อมากที่สุดในช่วงนี้")}</CardDescription>
      </CardHeader>
      <CardContent>
        <TopList q={q} verb="bought" color="var(--chart-3)" emptyText={tr("ไม่มีการซื้อในช่วงนี้")} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payment + revenue split

function PaymentCard({ range }: { range: Range }) {
  const q = useSummary(range);
  return (
    <Card data-shot="report-payment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="size-[18px] text-muted-foreground" /> {tr("รับเงินตามวิธีชำระ")}
        </CardTitle>
        <CardDescription>{tr("เงินที่ได้รับจริงในช่วงนี้ แยกตามวิธีชำระ (นับตามวันที่รับเงิน)")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <PaymentBreakdown summary={q.data} />
        )}
      </CardContent>
    </Card>
  );
}

/** Completed sales by the user who entered them (who sold how much). */
function SalesByUserCard({ range }: { range: Range }) {
  const q = useSummary(range);
  const rows = q.data?.salesByUser ?? [];
  const sum = rows.reduce((a, r) => a + r.total, 0);
  return (
    <Card data-shot="report-by-user">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Users className="size-[18px] text-muted-foreground" /> {tr("ยอดขายตามผู้บันทึกบิล")}
        </CardTitle>
        <CardDescription>{tr("บิลขายที่ไม่ยกเลิก แยกตามผู้ใช้ที่เปิดบิล")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-28 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("ยังไม่มีบิลขายในช่วงนี้")}</p>
        ) : (
          <MeterList
            color="var(--chart-2)"
            rows={rows.map((r) => ({
              key: r.userId ?? "none",
              label: r.name ?? tr("ไม่ระบุ (ก่อนมีระบบผู้ใช้)"),
              value: formatBaht(r.total),
              valueSub: tr("{0} บิล", r.count),
              ratio: sum > 0 ? r.total / sum : 0,
              muted: !r.userId,
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RevenueSplitCard({ range }: { range: Range }) {
  const q = useSummary(range);
  const rows = q.data?.salesByItemType ?? [];
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const types = (["product", "service", "custom"] as const).filter((t) => t !== "custom" || rows.some((r) => r.itemType === "custom"));
  return (
    <Card data-shot="report-split">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Layers className="size-[18px] text-muted-foreground" /> {tr("สัดส่วนรายได้ สินค้า / บริการ")}
        </CardTitle>
        <CardDescription>{tr("รวมยอดตามรายการในบิล (ก่อนหักส่วนลดท้ายบิล)")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <MeterList
            color="var(--chart-1)"
            rows={types.map((t) => {
              const total = rows.find((r) => r.itemType === t)?.total ?? 0;
              return {
                key: t,
                label: ITEM_TYPE_LABELS[t],
                value: formatBaht(total),
                valueSub: sum > 0 ? formatPercent(total / sum) : undefined,
                ratio: sum > 0 ? total / sum : 0,
                muted: total === 0,
              };
            })}
          />
        )}
      </CardContent>
    </Card>
  );
}
