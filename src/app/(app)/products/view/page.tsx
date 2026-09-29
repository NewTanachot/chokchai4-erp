"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  CircleDollarSign,
  History,
  MoreHorizontal,
  PackageX,
  Pencil,
  SlidersHorizontal,
  StickyNote,
  Tag,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { STOCK_MOVEMENT_TYPE_LABELS, type Product } from "@shared/contract";
import { EntityHistoryCard } from "@/components/audit/entity-history";
import { PriceHistoryTable } from "@/components/audit/price-history";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProductFormDialog } from "@/components/catalog/product-form-dialog";
import { formatPercent, marginOf, MovementTypeBadge, Pager, SignedQty, StockLevelBadge, stockLevel } from "@/components/catalog/shared";
import { StatCard } from "@/components/catalog/stat-card";
import { StockAdjustDialog } from "@/components/catalog/stock-adjust-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBaht, formatDate, formatQty, formatTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

const MOVES_PAGE = 20;

export default function ProductViewPage() {
  return (
    <Suspense>
      <ProductView />
    </Suspense>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground">
      <Link href="/products/">
        <ArrowLeft /> {tr("สินค้าทั้งหมด")}
      </Link>
    </Button>
  );
}

function ProductView() {
  const id = useSearchParam("id");
  const router = useRouter();
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // After a delete the post-save refetch of this product fails (NOT_FOUND) while we navigate away;
  // `deleted` keeps the page neutral instead of flashing "ไม่พบสินค้า".
  const [deleted, setDeleted] = useState(false);
  const product = useQuery({ queryKey: ["products", "get", id], queryFn: () => api.products.get(id!), enabled: !!id && !deleted });
  const remove = useApiMutation(
    async () => {
      await api.products.remove(id!);
      setDeleted(true);
      router.push("/products/");
    },
    { successMessage: tr("ลบสินค้าแล้ว") },
  );

  if (deleted) return <BackLink />;

  const notFound = !id || (product.error instanceof ApiClientError && product.error.code === "NOT_FOUND");
  if (!id || product.isError) {
    return (
      <>
        <BackLink />
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
              <PackageX />
            </EmptyMedia>
            <EmptyTitle className="text-base">{notFound ? tr("ไม่พบสินค้า") : tr("เปิดข้อมูลสินค้าไม่สำเร็จ")}</EmptyTitle>
            <EmptyDescription>
              {!id
                ? tr("ไม่ได้ระบุสินค้าที่ต้องการดู")
                : notFound
                  ? tr("สินค้านี้อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง")
                  : errorMessage(product.error)}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/products/">{tr("กลับไปหน้าสินค้า")}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  const p = product.data;
  return (
    <>
      <BackLink />
      {p ? (
        <ProductHeader
          product={p}
          onEdit={can("catalog.manage") ? () => setEditOpen(true) : null}
          onAdjust={can("stock.adjust") ? () => setAdjustOpen(true) : null}
          onDelete={can("catalog.manage") ? () => setDeleteOpen(true) : null}
        />
      ) : (
        <div className="mb-6 space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
      )}

      <Kpis product={p} />

      {p?.note ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="whitespace-pre-line">{p.note}</p>
        </div>
      ) : null}

      <StockCard productId={id} product={p} />

      {can("catalog.manage") || can("audit.view") ? (
        <Card className="mt-5 gap-0 py-0" data-shot="product-price-history">
          <CardHeader className="flex flex-row items-center gap-3 border-b py-4">
            <TrendingUp className="size-5 text-muted-foreground" />
            <div>
              <CardTitle>{tr("ประวัติราคา")}</CardTitle>
              <CardDescription>{tr("ราคาขายและราคาทุนที่เปลี่ยนไป ใครเปลี่ยน และเปลี่ยนเมื่อไหร่")}</CardDescription>
            </div>
          </CardHeader>
          <PriceHistoryTable itemType="product" id={id} />
        </Card>
      ) : null}

      {can("audit.view") ? <EntityHistoryCard entityType="product" entityId={id} className="mt-5" description={tr("การเพิ่ม แก้ไขข้อมูลสินค้า และปรับสต็อก")} /> : null}

      {p ? (
        <>
          <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} product={p} />
          <StockAdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} product={p} />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={tr("ลบสินค้า “{0}”?", p.name)}
            description={tr("สินค้าจะถูกซ่อนจากรายการและหน้าขาย บิลเก่าที่เคยขาย/ซื้อยังแสดงชื่อสินค้านี้ครบเหมือนเดิม")}
            confirmText={tr("ลบสินค้า")}
            destructive
            onConfirm={() => remove.mutate()}
          />
        </>
      ) : null}
    </>
  );
}

function ProductHeader({
  product: p,
  onEdit,
  onAdjust,
  onDelete,
}: {
  product: Product;
  /** null = not allowed (button hidden). */
  onEdit: (() => void) | null;
  onAdjust: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const level = stockLevel(p);
  const secondary = [p.brand, p.model, p.spec].filter(Boolean).join(" · ");
  const codes = [p.sku ? tr("รหัส {0}", p.sku) : null, p.barcode ? tr("บาร์โค้ด {0}", p.barcode) : null].filter(Boolean).join(" · ");
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          {p.isActive ? (
            <Badge className="bg-income/12 text-income dark:bg-income/18">{tr("เปิดขาย")}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {tr("ปิดขาย")}
            </Badge>
          )}
          <StockLevelBadge level={level} />
        </div>
        {secondary ? <p className="mt-1 text-base text-muted-foreground">{secondary}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="gap-1">
            <Tag /> {p.categoryName ?? tr("ไม่ระบุหมวดหมู่")}
          </Badge>
          {codes ? <span className="num">{codes}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onEdit ? (
          <Button variant="outline" size="lg" onClick={onEdit} data-shot="edit-product">
            <Pencil /> {tr("แก้ไข")}
          </Button>
        ) : null}
        {onAdjust ? (
          <Button size="lg" onClick={onAdjust} disabled={!p.trackStock} data-shot="adjust-stock">
            <SlidersHorizontal /> {tr("ปรับสต็อก")}
          </Button>
        ) : null}
        {onDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label={tr("เพิ่มเติม")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> {tr("ลบสินค้า")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

function Kpis({ product: p }: { product: Product | undefined }) {
  const loading = !p;
  const level = p ? stockLevel(p) : "ok";
  const { profit, percent } = marginOf(p?.costPrice ?? 0, p?.sellPrice ?? 0);
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Boxes}
        tone={level === "negative" || level === "out" ? "danger" : level === "low" ? "warning" : "default"}
        label={tr("คงเหลือ")}
        loading={loading}
        value={
          p?.trackStock ? (
            <>
              <span className={cn((level === "negative" || level === "out") && "text-destructive")}>{formatQty(p.stockQty)}</span>{" "}
              <span className="text-base font-normal text-muted-foreground">{p.unit}</span>
            </>
          ) : (
            <span className="text-lg text-muted-foreground">{tr("ไม่นับสต็อก")}</span>
          )
        }
        sub={
          p?.trackStock ? (
            <>
              {tr("มูลค่าทุน {0}", formatBaht(Math.round(Math.max(0, p.stockQty) * p.costPrice)))}
              <br />
              {tr("แจ้งเตือนเมื่อเหลือ ≤ {0} {1}", formatQty(p.minStock), p.unit)}
            </>
          ) : (
            tr("สินค้านี้ไม่ต้องนับจำนวน")
          )
        }
      />
      <StatCard icon={CircleDollarSign} label={tr("ราคาทุน")} loading={loading} value={formatBaht(p?.costPrice ?? 0)} sub={p ? tr("ต่อ{0}", p.unit) : undefined} />
      <StatCard icon={Tag} label={tr("ราคาขาย")} loading={loading} value={formatBaht(p?.sellPrice ?? 0)} sub={p ? tr("ต่อ{0}", p.unit) : undefined} />
      <StatCard
        icon={TrendingUp}
        tone={profit < 0 ? "danger" : "success"}
        label={tr("กำไรต่อหน่วย")}
        loading={loading}
        value={<span className={cn(profit < 0 && "text-destructive")}>{formatBaht(profit)}</span>}
        sub={percent !== null ? tr("{0} ของราคาขาย", formatPercent(percent)) : tr("ยังไม่ได้ตั้งราคาขาย")}
      />
    </div>
  );
}

function StockCard({ productId, product }: { productId: string; product: Product | undefined }) {
  const [offset, setOffset] = useState(0);
  const moves = useQuery({
    queryKey: ["products", "movements", productId, offset],
    queryFn: () => api.products.movements({ productId, limit: MOVES_PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const items = moves.data?.items ?? [];
  const unit = product?.unit ?? "";

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center gap-3 border-b py-4">
        <History className="size-5 text-muted-foreground" />
        <div>
          <CardTitle>{tr("ประวัติสต็อก")}</CardTitle>
          <CardDescription>{tr("รายการรับเข้า–จ่ายออกทั้งหมด เรียงจากล่าสุด")}</CardDescription>
        </div>
      </CardHeader>
      {moves.isPending ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : moves.isError ? (
        <p className="p-8 text-center text-sm text-destructive">{errorMessage(moves.error)}</p>
      ) : items.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>{tr("ยังไม่มีความเคลื่อนไหว")}</EmptyTitle>
            <EmptyDescription>{tr("เมื่อมีการซื้อเข้า ขายออก หรือปรับสต็อก รายการจะแสดงที่นี่")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table className={cn(moves.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">{tr("วันที่ เวลา")}</TableHead>
                <TableHead>{tr("ประเภท")}</TableHead>
                <TableHead>{tr("เลขที่บิล")}</TableHead>
                <TableHead className="text-right">{tr("จำนวน")}</TableHead>
                <TableHead className="text-right">{tr("คงเหลือ")}</TableHead>
                <TableHead className="hidden text-right lg:table-cell">{tr("ต้นทุน/หน่วย")}</TableHead>
                <TableHead className="hidden xl:table-cell">{tr("โดย")}</TableHead>
                <TableHead className="pr-4">{tr("หมายเหตุ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-4">
                    <div className="num">{formatDate(m.occurredAt)}</div>
                    <div className="num text-xs text-muted-foreground">{tr("{0} น.", formatTime(m.occurredAt))}</div>
                  </TableCell>
                  <TableCell>
                    <MovementTypeBadge type={m.type} />
                  </TableCell>
                  <TableCell>
                    {m.transactionId && m.docNo ? (
                      <div className="min-w-0">
                        <Link href={`/transactions/view/?id=${m.transactionId}`} className="num font-medium text-primary hover:underline">
                          {m.docNo}
                        </Link>
                        {m.partyName ? <div className="max-w-44 truncate text-xs text-muted-foreground">{m.partyName}</div> : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <SignedQty qty={m.qty} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={cn("num font-semibold", m.balance < 0 && "text-destructive")}>{formatQty(m.balance)}</span>{" "}
                    <span className="text-xs text-muted-foreground">{unit}</span>
                  </TableCell>
                  <TableCell className="num hidden text-right text-muted-foreground lg:table-cell">
                    {m.unitCost != null ? formatBaht(m.unitCost) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground xl:table-cell">{m.userName ?? "—"}</TableCell>
                  <TableCell className="max-w-56 truncate pr-4 text-muted-foreground" title={m.note ?? undefined}>
                    {m.note && m.note !== STOCK_MOVEMENT_TYPE_LABELS[m.type] ? m.note : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager className="border-t px-4 py-3" offset={offset} limit={MOVES_PAGE} total={moves.data?.total ?? 0} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}
