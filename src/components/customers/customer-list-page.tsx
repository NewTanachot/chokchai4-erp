"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, MessageCircle, Phone, RotateCcw, Search, Store, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CustomerInput, CustomerListQuery, CustomerWithStats } from "@shared/contract";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, errorMessage } from "@/lib/api";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { fetchFirst } from "@/lib/paging";
import { formatBaht, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { CustomerAvatar } from "./customer-avatar";
import { CustomerFormDialog } from "./customer-form-dialog";
import { customerViewHref, isPhoneLike, relativeTime } from "./customer-utils";
import { PlateChips } from "./plate-chip";

type Sort = NonNullable<CustomerListQuery["sort"]>;
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: tr("มาล่าสุด") },
  { value: "name", label: tr("ชื่อ ก-ฮ") },
  { value: "spent", label: tr("ยอดซื้อสูงสุด") },
];
const PAGE = 50;

/** Row grid: narrow = no vehicle column (plates go under the name); wide = dedicated column. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 " +
  // medium: visit count folds into the amount cell
  "@2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_8.5rem_6.5rem_1rem] " +
  // wide: separate visit-count column
  "@4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_4.5rem_8.5rem_7.5rem_1rem] @4xl:gap-x-4 " +
  // extra wide: vehicle column
  "@5xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.05fr)_minmax(0,1.25fr)_4.5rem_8.5rem_7.5rem_1rem]";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ListHeader() {
  return (
    <div className={cn(ROW_GRID, "hidden border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground @2xl:grid")}>
      <span>{trc("plural", "ลูกค้า")}</span>
      <span>{tr("ติดต่อ")}</span>
      <span className="hidden @5xl:block">{tr("รถที่เคยมา")}</span>
      <span className="hidden text-right @4xl:block">{tr("จำนวนครั้ง")}</span>
      <span className="text-right">{tr("ยอดซื้อรวม")}</span>
      <span className="text-right">{tr("มาล่าสุด")}</span>
      <span />
    </div>
  );
}

function CustomerRow({ c }: { c: CustomerWithStats }) {
  const router = useRouter();
  const href = customerViewHref(c.id);
  return (
    <div
      data-shot="customer-row"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        router.push(href);
      }}
      className={cn(ROW_GRID, "group cursor-pointer px-4 py-3 transition-colors hover:bg-muted/50")}
    >
      {/* customer */}
      <div className="flex min-w-0 items-center gap-3">
        <CustomerAvatar name={c.name} colorKey={c.id} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link href={href} className="min-w-0 font-medium break-words text-foreground hover:underline hover:underline-offset-3">
              {c.name}
            </Link>
            {c.unpaidTotal > 0 ? (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-expense/10 px-2 text-xs font-medium text-expense">{tr("ค้างชำระ")}</span>
            ) : null}
          </div>
          {c.shopName ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <Store className="size-3.5 shrink-0" />
              <span className="truncate">{c.shopName}</span>
            </div>
          ) : null}
          <PlateChips plates={c.vehiclePlates} max={2} className="mt-1.5 @5xl:hidden" />
        </div>
      </div>

      {/* contact */}
      <div className="col-span-full min-w-0 space-y-0.5 pl-13 text-sm @2xl:col-span-1 @2xl:pl-0">
        {c.phone ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="num truncate">{c.phone}</span>
            <CopyButton value={c.phone} label={tr("เบอร์โทร")} className="opacity-60 group-hover:opacity-100" />
          </div>
        ) : null}
        {c.lineId ? (
          <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <MessageCircle className="size-3.5 shrink-0" />
            <span className="truncate">{c.lineId}</span>
          </div>
        ) : null}
        {!c.phone && !c.lineId ? <span className="text-sm text-muted-foreground/70">{tr("ไม่มีข้อมูลติดต่อ")}</span> : null}
      </div>

      {/* vehicles (wide only) */}
      <div className="hidden min-w-0 @5xl:block">
        {c.vehiclePlates.length ? <PlateChips plates={c.vehiclePlates} max={2} /> : <span className="text-sm text-muted-foreground/70">—</span>}
      </div>

      {/* visits */}
      <div className="hidden text-right @4xl:block">
        {c.saleCount > 0 ? (
          <span className="num text-sm">
            <span className="font-semibold">{c.saleCount}</span> <span className="text-muted-foreground">{tr("ครั้ง")}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground/70">—</span>
        )}
      </div>

      {/* spent */}
      <div className="hidden text-right @2xl:block">
        <div className={cn("num text-sm font-semibold", c.totalSpent === 0 && "font-normal text-muted-foreground/70")}>
          {c.totalSpent > 0 ? formatBaht(c.totalSpent) : "—"}
        </div>
        {c.unpaidTotal > 0 ? <div className="num text-xs text-expense">{tr("ค้าง {0}", formatBaht(c.unpaidTotal))}</div> : null}
        {c.saleCount > 0 ? <div className="num text-xs text-muted-foreground @4xl:hidden">{tr("{0} ครั้ง", c.saleCount)}</div> : null}
      </div>

      {/* last visit */}
      <div className="hidden text-right @2xl:block">
        {c.lastVisitAt ? (
          <>
            <div className="text-sm">{relativeTime(c.lastVisitAt)}</div>
            <div className="text-xs text-muted-foreground">{formatDate(c.lastVisitAt)}</div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground/80">{tr("ยังไม่เคยมา")}</span>
        )}
      </div>

      <ChevronRight className="hidden size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground @2xl:block" />

      {/* narrow summary */}
      <div className="col-start-2 row-start-1 text-right @2xl:hidden">
        <div className="num text-sm font-semibold">{c.totalSpent > 0 ? formatBaht(c.totalSpent) : "—"}</div>
        <div className="text-xs text-muted-foreground">
          {c.saleCount > 0 ? tr("{0} ครั้ง · {1}", c.saleCount, relativeTime(c.lastVisitAt!)) : tr("ยังไม่เคยมา")}
        </div>
      </div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className={cn(ROW_GRID, "px-4 py-3.5")}>
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="hidden h-4 w-28 @2xl:block" />
          <Skeleton className="hidden h-6 w-32 @5xl:block" />
          <Skeleton className="ml-auto hidden h-4 w-10 @4xl:block" />
          <Skeleton className="ml-auto h-4 w-20" />
          <Skeleton className="ml-auto hidden h-4 w-16 @2xl:block" />
          <span className="hidden @2xl:block" />
        </div>
      ))}
    </div>
  );
}

export function CustomerListPage() {
  const router = useRouter();
  const initialQ = useSearchParam("q") ?? "";
  const [search, setSearch] = useState(initialQ);
  const [sort, setSort] = useState<Sort>("recent");
  const [limit, setLimit] = useState(PAGE);
  const [formOpen, setFormOpen] = useState(false);
  const [formDefaults, setFormDefaults] = useState<Partial<CustomerInput> | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(search.trim(), 250);

  // Keep the search in the URL so "back" from a customer returns to the same results.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  }, [q]);

  useEffect(() => setLimit(PAGE), [q, sort]);

  const query = { search: q || undefined, sort, limit, offset: 0 } satisfies CustomerListQuery;
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["customers", "list", query],
    queryFn: () => fetchFirst(limit, (limit, offset) => api.customers.list({ ...query, limit, offset })),
    placeholderData: keepPreviousData,
  });

  const openNew = (defaults?: Partial<CustomerInput>) => {
    setFormDefaults(defaults);
    setFormOpen(true);
  };
  // `?new=1` (e.g. the dashboard's "เพิ่มลูกค้า" button) opens the form once, then drops the param.
  const wantsNew = useSearchParam("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    openNew();
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url.href);
  }, [wantsNew]);

  const newFromSearch = () => {
    const s = search.trim();
    openNew(s ? (isPhoneLike(s) ? { phone: s } : { name: s }) : undefined);
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const noCustomersAtAll = !isPending && !isError && total === 0 && !q;

  return (
    <>
      <PageHeader
        title={trc("plural", "ลูกค้า")}
        description={
          data && !q ? tr("ข้อมูลติดต่อและประวัติการใช้บริการ · ทั้งหมด {0} ราย", total.toLocaleString(LOCALE)) : tr("ข้อมูลติดต่อและประวัติการใช้บริการ")
        }
        actions={
          <Button size="lg" className="px-4" data-shot="new-customer" onClick={() => openNew()}>
            <UserPlus /> {tr("เพิ่มลูกค้า")}
          </Button>
        }
      />

      {!noCustomersAtAll ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <InputGroup className="h-10 max-w-xl min-w-64 flex-1 bg-card">
            <InputGroupAddon>
              {isFetching && !isPending ? <Spinner className="size-4" /> : <Search className="size-4" />}
            </InputGroupAddon>
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
                if (e.key === "Enter" && items.length === 1) router.push(customerViewHref(items[0].id));
              }}
              placeholder={tr("ค้นหาชื่อ, เบอร์โทร, LINE, ร้านค้า หรือทะเบียนรถ")}
              aria-label={tr("ค้นหาลูกค้า")}
              className="text-sm"
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

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground lg:inline">{tr("เรียงตาม")}</span>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={sort}
              onValueChange={(v) => v && setSort(v as Sort)}
              className="bg-card"
              aria-label={tr("เรียงตาม")}
            >
              {SORTS.map((s) => (
                <ToggleGroupItem key={s.value} value={s.value} className="h-10 px-3.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      ) : null}

      {isError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{tr("โหลดรายชื่อลูกค้าไม่สำเร็จ")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RotateCcw /> {tr("ลองใหม่")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : noCustomersAtAll ? (
        <Empty className="border bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-14 rounded-2xl bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-7">
              <Users />
            </EmptyMedia>
            <EmptyTitle className="text-lg">{tr("ยังไม่มีข้อมูลลูกค้า")}</EmptyTitle>
            <EmptyDescription>{tr("เพิ่มลูกค้าไว้เพื่อเก็บเบอร์โทร ทะเบียนรถ และดูย้อนหลังได้ว่าเคยมาทำอะไรไปเมื่อไหร่")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" className="px-5" onClick={() => openNew()}>
              <UserPlus /> {tr("เพิ่มลูกค้าคนแรก")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="@container overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-label={tr("รายชื่อลูกค้า")}>
          {isPending || items.length > 0 ? <ListHeader /> : null}
          {isPending ? (
            <RowsSkeleton />
          ) : items.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-xl [&_svg:not([class*='size-'])]:size-6">
                  <Search />
                </EmptyMedia>
                <EmptyTitle className="text-base">{tr("ไม่พบลูกค้าที่ตรงกับ “{0}”", q)}</EmptyTitle>
                <EmptyDescription>{tr("ลองค้นด้วยชื่อ เบอร์โทร (พิมพ์แค่ตัวเลขก็ได้) LINE หรือทะเบียนรถ")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row justify-center">
                <Button variant="outline" size="lg" onClick={() => setSearch("")}>
                  {tr("ล้างคำค้น")}
                </Button>
                <Button size="lg" onClick={newFromSearch}>
                  <UserPlus /> {tr("เพิ่มเป็นลูกค้าใหม่")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className={cn("divide-y transition-opacity", isPlaceholderData && "opacity-60")}>
              {items.map((c) => (
                <CustomerRow key={c.id} c={c} />
              ))}
            </div>
          )}
          {items.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
              <span>
                {q ? tr("พบ {0} ราย", total.toLocaleString(LOCALE)) : tr("แสดง {0} จาก {1} ราย", items.length.toLocaleString(LOCALE), total.toLocaleString(LOCALE))}
              </span>
              {items.length < total ? (
                <Button variant="outline" size="sm" disabled={isFetching} onClick={() => setLimit((l) => l + PAGE)}>
                  {isFetching ? <Spinner /> : null} {tr("แสดงเพิ่ม (อีก {0} ราย)", Math.min(PAGE, total - items.length))}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultValues={formDefaults}
        onSaved={(c) => router.push(customerViewHref(c.id))}
      />
    </>
  );
}
