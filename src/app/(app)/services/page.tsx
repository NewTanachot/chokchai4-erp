"use client";
import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, History, Info, MoreHorizontal, Pencil, Plus, Search, SearchX, Trash2, Wrench, X } from "lucide-react";
import type { ServiceItem, ServiceItemListQuery } from "@shared/contract";
import { PriceHistoryTable } from "@/components/audit/price-history";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MoneyInput } from "@/components/money-input";
import { ServiceFormDialog } from "@/components/catalog/service-form-dialog";
import { useDebouncedValue } from "@/components/catalog/shared";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { fetchFirst } from "@/lib/paging";
import { formatBaht } from "@/lib/format";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

const PAGE = 100;

export default function ServicesPage() {
  const { can } = useAuth();
  const canManage = can("catalog.manage");
  const canSeePrices = canManage || can("audit.view");
  const [historyOf, setHistoryOf] = useState<ServiceItem | null>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [deleting, setDeleting] = useState<ServiceItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLimit(PAGE), [debounced, includeInactive]);

  const query: ServiceItemListQuery = { search: debounced || undefined, includeInactive: includeInactive || undefined, limit };
  const list = useQuery({
    queryKey: ["serviceItems", "list", query],
    queryFn: () => fetchFirst(limit, (limit, offset) => api.serviceItems.list({ ...query, limit, offset })),
    placeholderData: keepPreviousData,
  });
  const remove = useApiMutation((id: string) => api.serviceItems.remove(id), {
    successMessage: tr("ลบบริการแล้ว"),
    onSettled: () => setDeleting(null),
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const unpriced = items.filter((s) => s.isActive && s.defaultPrice === 0).length;
  // Hide the code column until the shop actually uses service codes.
  const showCode = items.some((s) => s.code);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (s: ServiceItem) => {
    setEditing(s);
    setFormOpen(true);
  };

  return (
    <>
      <PageHeader
        title={trc("plural", "บริการ")}
        description={tr("ค่าแรงและบริการของร้าน พร้อมราคาตั้งต้น — ตอนออกบิลแก้ราคาได้ทุกครั้ง")}
        actions={
          canManage ? (
            <Button size="lg" onClick={openCreate} data-shot="new-service">
              <Plus /> {tr("เพิ่มบริการ")}
            </Button>
          ) : null
        }
      />

      {unpriced > 0 && canManage ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/60 bg-warning/15 px-4 py-3 text-sm dark:bg-warning/10">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
          <p>
            {tr("มี")} <span className="num font-semibold">{unpriced.toLocaleString(LOCALE)}</span> {tr("บริการที่ยังไม่ได้ตั้งราคา — คลิกที่ราคาในตารางเพื่อใส่ราคาได้ทันที (ถ้าราคาไม่แน่นอน ปล่อยเป็น 0 แล้วค่อยใส่ตอนออกบิลก็ได้)")}
          </p>
        </div>
      ) : null}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:p-4">
          <InputGroup className="h-10 min-w-64 flex-1 bg-background dark:bg-input/30">
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
              placeholder={tr("ค้นหาชื่อบริการ หรือรหัส เช่น ถ่วงล้อ")}
              aria-label={tr("ค้นหาบริการ")}
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
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm whitespace-nowrap hover:bg-muted/50">
            <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} />
            {tr("แสดงที่ปิดใช้งาน")}
          </label>
        </div>

        {list.isError ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertTriangle />
              </EmptyMedia>
              <EmptyTitle>{tr("โหลดรายการบริการไม่สำเร็จ")}</EmptyTitle>
              <EmptyDescription>{errorMessage(list.error)}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => list.refetch()}>
                {tr("ลองอีกครั้ง")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : list.isPending ? (
          <div className="divide-y">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          debounced ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle className="text-base">{tr("ไม่พบบริการที่ตรงกับ “{0}”", debounced)}</EmptyTitle>
                <EmptyDescription>{tr("ลองพิมพ์คำอื่น หรือเพิ่มเป็นบริการใหม่")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row justify-center">
                <Button variant="outline" onClick={() => setSearch("")}>
                  {tr("ล้างคำค้น")}
                </Button>
                {canManage ? (
                  <Button onClick={openCreate}>
                    <Plus /> {tr("เพิ่มบริการใหม่")}
                  </Button>
                ) : null}
              </EmptyContent>
            </Empty>
          ) : (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                  <Wrench />
                </EmptyMedia>
                <EmptyTitle className="text-base">{tr("ยังไม่มีรายการบริการ")}</EmptyTitle>
                <EmptyDescription>{tr("เพิ่มบริการที่ร้านทำ เช่น ถ่วงล้อ ตั้งศูนย์ล้อ ปะยาง พร้อมราคาตั้งต้น เพื่อออกบิลได้เร็วขึ้น")}</EmptyDescription>
              </EmptyHeader>
              {canManage ? (
                <EmptyContent>
                  <Button size="lg" onClick={openCreate}>
                    <Plus /> {tr("เพิ่มบริการแรก")}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          )
        ) : (
          <>
            <Table className={cn(list.isPlaceholderData && "opacity-60")}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">{tr("ชื่อบริการ")}</TableHead>
                  {showCode ? <TableHead>{tr("รหัส")}</TableHead> : null}
                  <TableHead>{tr("หน่วย")}</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      {tr("ราคาตั้งต้น")}
                      {canManage ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="size-3.5 text-muted-foreground" aria-label={tr("วิธีแก้ราคา")} />
                          </TooltipTrigger>
                          <TooltipContent>{tr("คลิกที่ราคาเพื่อแก้ไขทันที · Enter บันทึก · Esc ยกเลิก")}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </span>
                  </TableHead>
                  <TableHead className="text-center">{tr("สถานะ")}</TableHead>
                  <TableHead className="w-12 pr-3">
                    <span className="sr-only">{tr("จัดการ")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => (
                  <TableRow key={s.id} className={cn(!s.isActive && "text-muted-foreground")}>
                    <TableCell className="w-full max-w-0 py-2.5 pl-4">
                      {canManage ? (
                        <button type="button" className="block max-w-full truncate text-left font-semibold hover:underline" onClick={() => openEdit(s)}>
                          {s.name}
                        </button>
                      ) : (
                        <span className="block max-w-full truncate font-semibold">{s.name}</span>
                      )}
                      {s.note ? <div className="truncate text-xs text-muted-foreground">{s.note}</div> : null}
                    </TableCell>
                    {showCode ? <TableCell className="num text-muted-foreground">{s.code ?? "—"}</TableCell> : null}
                    <TableCell>{s.unit}</TableCell>
                    <TableCell className="py-1.5 text-right">
                      {canManage ? <InlinePrice service={s} /> : <span className="num pr-2.5 font-medium">{formatBaht(s.defaultPrice)}</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.isActive ? (
                        <Badge className="bg-income/12 text-income dark:bg-income/18">{tr("เปิดใช้งาน")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {tr("ปิดใช้งาน")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-3">
                      {canManage || canSeePrices ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={tr("จัดการ {0}", s.name)}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            {canManage ? (
                              <DropdownMenuItem onSelect={() => openEdit(s)}>
                                <Pencil /> {tr("แก้ไข")}
                              </DropdownMenuItem>
                            ) : null}
                            {canSeePrices ? (
                              <DropdownMenuItem onSelect={() => setHistoryOf(s)} data-shot="service-price-history">
                                <History /> {tr("ประวัติราคา")}
                              </DropdownMenuItem>
                            ) : null}
                            {canManage ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(s)}>
                                  <Trash2 /> {tr("ลบ")}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
              <span>
                {tr("ทั้งหมด")} <span className="num text-foreground">{total.toLocaleString(LOCALE)}</span> {trc("unit", "บริการ")}
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

      <ServiceFormDialog open={formOpen} onOpenChange={setFormOpen} service={editing} />
      <Dialog open={!!historyOf} onOpenChange={(o) => !o && setHistoryOf(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 pt-4 pb-3.5">
            <DialogTitle>{tr("ประวัติราคา — {0}", historyOf?.name)}</DialogTitle>
            <DialogDescription>{tr("ราคาตั้งต้นที่เปลี่ยนไป ใครเปลี่ยน และเปลี่ยนเมื่อไหร่")}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto">{historyOf ? <PriceHistoryTable itemType="service" id={historyOf.id} showField={false} /> : null}</div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={tr("ลบบริการ “{0}”?", deleting?.name ?? "")}
        description={tr("บริการจะถูกซ่อนจากรายการและหน้าขาย บิลเก่ายังแสดงชื่อบริการนี้ครบเหมือนเดิม")}
        confirmText={tr("ลบบริการ")}
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </>
  );
}

/** Click the price to edit it in place: Enter / blur saves, Esc cancels. */
function InlinePrice({ service: s }: { service: ServiceItem }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number>(s.defaultPrice);
  /** Set once the edit is committed or cancelled, so a trailing blur doesn't save again. */
  const finished = useRef(false);
  const save = useApiMutation(
    (price: number) =>
      api.serviceItems.update({ id: s.id, name: s.name, code: s.code, unit: s.unit, isActive: s.isActive, note: s.note, defaultPrice: price }),
    { successMessage: (r) => tr("ตั้งราคา “{0}” เป็น {1} แล้ว", r.name, formatBaht(r.defaultPrice)), onSettled: () => setEditing(false) },
  );

  if (editing) {
    const commit = () => {
      if (finished.current) return;
      finished.current = true;
      if (value === s.defaultPrice) return setEditing(false);
      save.mutate(value);
    };
    return (
      <div className="ml-auto flex w-36 items-center gap-1">
        <MoneyInput
          autoFocus
          className="h-9"
          value={value}
          disabled={save.isPending}
          aria-label={tr("ราคาตั้งต้นของ {0}", s.name)}
          onChange={(v) => setValue(v ?? 0)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finished.current = true;
              setEditing(false);
            }
          }}
          onBlur={commit}
        />
        {save.isPending ? <Spinner className="shrink-0" /> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-shot="inline-price"
      onClick={() => {
        finished.current = false;
        setValue(s.defaultPrice);
        setEditing(true);
      }}
      className={cn(
        "group inline-flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        s.defaultPrice === 0 && "border border-dashed border-warning/80 bg-warning/10 hover:bg-warning/20",
      )}
      title={tr("คลิกเพื่อแก้ราคา")}
    >
      {s.defaultPrice === 0 ? (
        <span className="text-sm text-muted-foreground">{tr("ยังไม่ได้ตั้งราคา")}</span>
      ) : (
        <span className="num font-medium text-foreground">{formatBaht(s.defaultPrice)}</span>
      )}
      <Pencil className="size-3.5 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
