"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpDown,
  FolderCog,
  History,
  MoreHorizontal,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { NO_CATEGORY, type Product, type ProductListQuery } from "@shared/contract";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CategoryManagerDialog } from "@/components/catalog/category-manager-dialog";
import { ProductFormDialog } from "@/components/catalog/product-form-dialog";
import { FilterChip, StockCell, useDebouncedValue } from "@/components/catalog/shared";
import { StatCard } from "@/components/catalog/stat-card";
import { StockAdjustDialog } from "@/components/catalog/stock-adjust-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { fetchFirst } from "@/lib/paging";
import { formatBaht } from "@/lib/format";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

const PAGE = 50;
type Sort = NonNullable<ProductListQuery["sort"]>;
const SORT_LABELS: Record<Sort, string> = { name: tr("ชื่อสินค้า (ก-ฮ)"), stock: tr("คงเหลือน้อยก่อน"), updated: tr("แก้ไขล่าสุด") };

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsInner />
    </Suspense>
  );
}

function ProductsInner() {
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("catalog.manage");
  const initialLow = useSearchParam("lowStock") === "1";
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(initialLow);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // Reset paging when filters change.
  useEffect(() => setLimit(PAGE), [debounced, categoryId, lowStockOnly, includeInactive, sort]);

  const query: ProductListQuery = {
    search: debounced || undefined,
    categoryId: categoryId ?? undefined,
    lowStockOnly: lowStockOnly || undefined,
    includeInactive: includeInactive || undefined,
    sort,
    limit,
  };
  const list = useQuery({
    queryKey: ["products", "list", query],
    queryFn: () => fetchFirst(limit, (limit, offset) => api.products.list({ ...query, limit, offset })),
    placeholderData: keepPreviousData,
  });
  const stats = useQuery({ queryKey: ["products", "stats"], queryFn: () => api.products.stats() });
  const categories = useQuery({ queryKey: ["categories", "list"], queryFn: () => api.categories.list() });

  const remove = useApiMutation((id: string) => api.products.remove(id), {
    successMessage: tr("ลบสินค้าแล้ว"),
    onSettled: () => setDeleting(null),
  });

  // Per-category counts come from stats (all products); hide them while search / low-stock narrows the list.
  const showCounts = !!stats.data && !debounced && !lowStockOnly;
  const chips = useMemo(() => {
    const by = stats.data?.byCategory ?? [];
    const count = (id: string | null) => {
      const row = by.find((b) => b.categoryId === id);
      return row ? (includeInactive ? row.totalCount : row.activeCount) : 0;
    };
    const all = by.reduce((s, b) => s + (includeInactive ? b.totalCount : b.activeCount), 0);
    const cats = (categories.data ?? []).map((c) => ({ id: c.id, name: c.name, count: count(c.id) }));
    const none = count(null);
    return { all, cats, none };
  }, [stats.data, categories.data, includeInactive]);

  const s = stats.data;
  const totalProducts = (s?.productCount ?? 0) + (s?.inactiveCount ?? 0);
  const hasFilters = !!debounced || !!categoryId || lowStockOnly;
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setFormOpen(true);
  };
  const clearFilters = () => {
    setSearch("");
    setCategoryId(null);
    setLowStockOnly(false);
  };

  return (
    <>
      <PageHeader
        title={tr("สินค้า & สต็อก")}
        description={tr("ข้อมูลสินค้า ราคาซื้อ-ราคาขาย และจำนวนคงเหลือ")}
        actions={
          canManage ? (
            <>
              <Button variant="outline" size="lg" onClick={() => setCategoriesOpen(true)} data-shot="categories">
                <FolderCog /> {trc("plural", "หมวดหมู่")}
              </Button>
              <Button size="lg" onClick={openCreate} data-shot="new-product">
                <Plus /> {tr("เพิ่มสินค้า")}
              </Button>
            </>
          ) : null
        }
      />

      <div className={cn("mb-5 grid gap-3", can("reports.view") ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <StatCard
          icon={Package}
          label={tr("จำนวนสินค้า")}
          loading={stats.isPending}
          value={
            <>
              {(s?.productCount ?? 0).toLocaleString(LOCALE)} <span className="text-base font-normal text-muted-foreground">{trc("unit", "รายการ")}</span>
            </>
          }
          sub={s?.inactiveCount ? tr("ปิดขายอีก {0} รายการ", s.inactiveCount.toLocaleString(LOCALE)) : tr("ที่เปิดขายอยู่")}
        />
        {can("reports.view") ? (
          <StatCard
            icon={Wallet}
            tone="success"
            label={tr("มูลค่าสต็อก (ราคาทุน)")}
            loading={stats.isPending}
            value={formatBaht(s?.stockValue ?? 0)}
            sub={tr("คิดจากคงเหลือ × ราคาทุน")}
          />
        ) : null}
        <StatCard
          icon={AlertTriangle}
          tone={(s?.lowStockCount ?? 0) > 0 ? "warning" : "default"}
          label={tr("ใกล้หมด")}
          loading={stats.isPending}
          value={
            <>
              {(s?.lowStockCount ?? 0).toLocaleString(LOCALE)} <span className="text-base font-normal text-muted-foreground">{trc("unit", "รายการ")}</span>
            </>
          }
          sub={
            lowStockOnly
              ? tr("กำลังแสดงเฉพาะสินค้าใกล้หมด · คลิกเพื่อดูทั้งหมด")
              : (s?.lowStockCount ?? 0) > 0
                ? tr("คลิกเพื่อดูสินค้าที่ต้องสั่งเพิ่ม")
                : tr("ยังไม่มีสินค้าที่ต้องสั่งเพิ่ม")
          }
          onClick={() => setLowStockOnly((v) => !v)}
          active={lowStockOnly}
          data-shot="low-stock-card"
        />
      </div>

      <Card className="@container gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="h-10 min-w-56 flex-1 bg-background dark:bg-input/30">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && search) {
                    e.preventDefault();
                    setSearch("");
                  }
                }}
                placeholder={tr("ค้นหาชื่อ, รหัส, ยี่ห้อ หรือขนาด เช่น 205/55R16")}
                aria-label={tr("ค้นหาสินค้า")}
                className="text-base"
              />
              {search ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={tr("ล้างคำค้น")}
                    onClick={() => {
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>

            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm whitespace-nowrap hover:bg-muted/50 has-data-checked:border-warning has-data-checked:bg-warning/15">
              <Switch checked={lowStockOnly} onCheckedChange={setLowStockOnly} />
              {tr("เฉพาะใกล้หมด")}
            </label>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm whitespace-nowrap hover:bg-muted/50">
              <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} />
              {tr("แสดงที่ปิดขาย")}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10 px-3" aria-label={tr("เรียงลำดับ")} title={tr("เรียงตาม: {0}", SORT_LABELS[sort])}>
                  <ArrowUpDown /> <span className="hidden @5xl:inline">{SORT_LABELS[sort]}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                  {(Object.keys(SORT_LABELS) as Sort[]).map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {SORT_LABELS[k]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className={cn("flex flex-wrap gap-2", s && totalProducts === 0 && "hidden")} role="group" aria-label={tr("กรองตามหมวดหมู่")}>
            <FilterChip active={categoryId === null} onClick={() => setCategoryId(null)} count={showCounts ? chips.all : undefined}>
              {tr("ทั้งหมด")}
            </FilterChip>
            {chips.cats.map((c) => (
              <FilterChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)} count={showCounts ? c.count : undefined}>
                {c.name}
              </FilterChip>
            ))}
            {chips.none > 0 ? (
              <FilterChip active={categoryId === NO_CATEGORY} onClick={() => setCategoryId(categoryId === NO_CATEGORY ? null : NO_CATEGORY)} count={showCounts ? chips.none : undefined}>
                {tr("ไม่ระบุหมวดหมู่")}
              </FilterChip>
            ) : null}
          </div>
        </div>

        {list.isError ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertTriangle />
              </EmptyMedia>
              <EmptyTitle>{tr("โหลดรายการสินค้าไม่สำเร็จ")}</EmptyTitle>
              <EmptyDescription>{errorMessage(list.error)}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => list.refetch()}>
                {tr("ลองอีกครั้ง")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : list.isPending ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          !hasFilters && !includeInactive && totalProducts === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                  <Package />
                </EmptyMedia>
                <EmptyTitle className="text-base">{tr("ยังไม่มีสินค้า")}</EmptyTitle>
                <EmptyDescription>{tr("เริ่มจากเพิ่มสินค้าที่ขายบ่อย เช่น ยาง แบตเตอรี่ หรืออะไหล่ช่วงล่าง พร้อมราคาทุน ราคาขาย และจำนวนที่มี")}</EmptyDescription>
              </EmptyHeader>
              {canManage ? (
                <EmptyContent>
                  <Button size="lg" onClick={openCreate}>
                    <Plus /> {tr("เพิ่มสินค้าชิ้นแรก")}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                  <PackageSearch />
                </EmptyMedia>
                <EmptyTitle className="text-base">{debounced ? tr("ไม่พบสินค้าที่ตรงกับ “{0}”", debounced) : tr("ไม่มีสินค้าตามตัวกรองนี้")}</EmptyTitle>
                <EmptyDescription>
                  {lowStockOnly && !debounced ? tr("ดีมาก! ไม่มีสินค้าที่ใกล้หมด") : tr("ลองพิมพ์คำอื่น เช่น ยี่ห้อ หรือขนาด 2055516 หรือเลือกหมวดหมู่อื่น")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row justify-center">
                {hasFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    <SlidersHorizontal /> {tr("ล้างตัวกรอง")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button onClick={openCreate}>
                    <Plus /> {tr("เพิ่มสินค้าใหม่")}
                  </Button>
                ) : null}
              </EmptyContent>
            </Empty>
          )
        ) : (
          <>
            <Table className={cn("text-sm", list.isPlaceholderData && "opacity-60 transition-opacity")}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">{tr("สินค้า")}</TableHead>
                  <TableHead className="hidden @4xl:table-cell">{tr("หมวดหมู่")}</TableHead>
                  <TableHead className="text-right">{tr("ราคาทุน")}</TableHead>
                  <TableHead className="text-right">{tr("ราคาขาย")}</TableHead>
                  <TableHead className="pr-2 text-right">{tr("คงเหลือ")}</TableHead>
                  <TableHead className="w-12 pr-3">
                    <span className="sr-only">{tr("จัดการ")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onOpen={() => router.push(`/products/view/?id=${p.id}`)}
                    onEdit={canManage ? () => openEdit(p) : null}
                    onAdjust={can("stock.adjust") ? () => setAdjusting(p) : null}
                    onDelete={canManage ? () => setDeleting(p) : null}
                  />
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
              <span>
                {tr("แสดง")} <span className="num text-foreground">{items.length.toLocaleString(LOCALE)}</span> {tr("จาก ")}
                <span className="num text-foreground">{total.toLocaleString(LOCALE)}</span> {trc("unit", "รายการ")}
              </span>
              {items.length < total ? (
                <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)} disabled={list.isFetching}>
                  {list.isFetching ? <Spinner /> : null} {tr("โหลดเพิ่ม")}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Card>

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} defaultCategoryId={categoryId !== NO_CATEGORY ? categoryId : null} />
      <StockAdjustDialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)} product={adjusting} />
      <CategoryManagerDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        onShowProducts={(id) => {
          setSearch("");
          setLowStockOnly(false);
          setIncludeInactive(true);
          setCategoryId(id);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={tr("ลบสินค้า “{0}”?", deleting?.name ?? "")}
        description={tr("สินค้าจะถูกซ่อนจากรายการและหน้าขาย บิลเก่าที่เคยขาย/ซื้อยังแสดงชื่อสินค้านี้ครบเหมือนเดิม")}
        confirmText={tr("ลบสินค้า")}
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </>
  );
}

function ProductRow({
  product: p,
  onOpen,
  onEdit,
  onAdjust,
  onDelete,
}: {
  product: Product;
  onOpen: () => void;
  /** null = not allowed (the menu item is hidden). */
  onEdit: (() => void) | null;
  onAdjust: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const secondary = [p.brand, p.model, p.spec].filter(Boolean).join(" · ");
  return (
    <TableRow className={cn("cursor-pointer", !p.isActive && "text-muted-foreground")} onClick={onOpen}>
      <TableCell className="w-full max-w-0 py-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/products/view/?id=${p.id}`}
            className="truncate font-semibold text-foreground hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {p.name}
          </Link>
          {!p.isActive ? (
            <Badge variant="outline" className="text-muted-foreground">
              {tr("ปิดขาย")}
            </Badge>
          ) : null}
        </div>
        {/* Wraps instead of truncating so the tyre size / spec stays readable in narrow windows. */}
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {secondary ? <span className="max-w-full min-w-0 truncate">{secondary}</span> : null}
          {p.sku ? <span className="num shrink-0 rounded bg-muted px-1.5 py-px text-[11px]">{p.sku}</span> : null}
          {p.categoryName ? <span className="shrink-0 @4xl:hidden">· {p.categoryName}</span> : null}
        </div>
      </TableCell>
      <TableCell className="hidden @4xl:table-cell">
        {p.categoryName ? <Badge variant="secondary">{p.categoryName}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="num text-right text-muted-foreground">{formatBaht(p.costPrice)}</TableCell>
      <TableCell className="num text-right font-medium">{formatBaht(p.sellPrice)}</TableCell>
      <TableCell className="pr-2 text-right">
        <StockCell product={p} />
      </TableCell>
      <TableCell className="pr-3" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={tr("จัดการ {0}", p.name)}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {onEdit ? (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> {tr("แก้ไข")}
              </DropdownMenuItem>
            ) : null}
            {onAdjust ? (
              <DropdownMenuItem onSelect={onAdjust} disabled={!p.trackStock}>
                <SlidersHorizontal /> {tr("ปรับสต็อก")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onOpen}>
              <History /> {tr("ประวัติสต็อก")}
            </DropdownMenuItem>
            {onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> {tr("ลบ")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
