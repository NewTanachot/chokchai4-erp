"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History, Search, SearchX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AUDIT_ENTITY_LABELS, type AuditEntityType, type AuditEntry, type AuditListQuery } from "@shared/contract";
import { FilterChip, useDebouncedValue } from "@/components/catalog/shared";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { AUTH_QUERY_KEY, useAuth } from "@/lib/auth";
import { dayRange, formatDateLong, lastDaysRange } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { fetchFirst } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { AuditEntryView } from "./audit-entry";

const PAGE = 50;
const ALL = "__all__";

type Preset = "today" | "7d" | "30d" | "all";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: tr("วันนี้") },
  { id: "7d", label: tr("7 วันล่าสุด") },
  { id: "30d", label: tr("30 วันล่าสุด") },
  { id: "all", label: tr("ทั้งหมด") },
];

function presetRange(p: Preset): { from?: number; to?: number } {
  if (p === "today") return dayRange();
  if (p === "7d") return lastDaysRange(7);
  if (p === "30d") return lastDaysRange(30);
  return {};
}

/** Entity types in the filter, in a sensible order; pay data only for employees.manage. */
const TYPES: AuditEntityType[] = ["transaction", "product", "service", "category", "customer", "employee", "attendance", "leave", "advance", "payroll", "payslip", "user", "settings"];
const PRIVATE: AuditEntityType[] = ["employee", "advance", "payroll", "payslip"];

export function AuditFeed() {
  const { can } = useAuth();
  const [preset, setPreset] = useState<Preset>("7d");
  const [entityType, setEntityType] = useState<string>(ALL);
  const [userId, setUserId] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [preset, entityType, userId, debounced]);

  // Active users for the "who" filter (the same list as the login screen).
  const status = useQuery({ queryKey: AUTH_QUERY_KEY, queryFn: () => api.auth.status(), staleTime: Infinity });
  const types = TYPES.filter((t) => (PRIVATE.includes(t) ? can("employees.manage") : t === "attendance" || t === "leave" ? can("employees.manage") || can("attendance.manage") : true));

  const query: AuditListQuery = useMemo(
    () => ({
      ...presetRange(preset),
      entityType: entityType === ALL ? undefined : entityType,
      userId: userId === ALL ? undefined : userId,
      search: debounced || undefined,
    }),
    [preset, entityType, userId, debounced],
  );
  const list = useQuery({
    queryKey: ["audit", "list", query, limit],
    queryFn: () => fetchFirst(limit, (l, offset) => api.audit.list({ ...query, limit: l, offset })),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  // Group by local day.
  const days = useMemo(() => {
    const out: { key: string; at: number; items: AuditEntry[] }[] = [];
    for (const e of items) {
      const key = new Date(e.at).toDateString();
      const last = out.at(-1);
      if (last?.key === key) last.items.push(e);
      else out.push({ key, at: e.at, items: [e] });
    }
    return out;
  }, [items]);

  const filtered = preset !== "all" || entityType !== ALL || userId !== ALL || !!debounced;

  return (
    <>
      <PageHeader title={tr("ประวัติการแก้ไข")} description={tr("ใครสร้าง แก้ไข หรือลบอะไรในโปรแกรม เมื่อไหร่ — บิล สินค้า ราคา ลูกค้า การตั้งค่า และการเข้าสู่ระบบ")} />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="h-10 min-w-56 flex-1 bg-background dark:bg-input/30">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr("ค้นหาเลขที่บิล ชื่อสินค้า ชื่อลูกค้า หรือชื่อผู้ใช้")}
                aria-label={tr("ค้นหาประวัติ")}
                className="text-base"
              />
              {search ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label={tr("ล้างคำค้น")} onClick={() => setSearch("")}>
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="h-10 w-44" aria-label={tr("ประเภทข้อมูล")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tr("ทุกประเภท")}</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {AUDIT_ENTITY_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="h-10 w-40" aria-label={tr("ผู้ใช้")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tr("ทุกคน")}</SelectItem>
                {(status.data?.users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={tr("ช่วงเวลา")}>
            {PRESETS.map((p) => (
              <FilterChip key={p.id} active={preset === p.id} onClick={() => setPreset(p.id)}>
                {p.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {list.isPending ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <p className="p-8 text-center text-sm text-destructive">{errorMessage(list.error)}</p>
        ) : items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                {filtered ? <SearchX /> : <History />}
              </EmptyMedia>
              <EmptyTitle className="text-base">{filtered ? tr("ไม่พบประวัติตามตัวกรองนี้") : tr("ยังไม่มีประวัติ")}</EmptyTitle>
              <EmptyDescription>{filtered ? tr("ลองเลือกช่วงเวลา “ทั้งหมด” หรือเปลี่ยนตัวกรอง") : tr("เมื่อมีการเปิดบิล แก้ไขข้อมูล หรือเปลี่ยนราคา ประวัติจะแสดงที่นี่")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className={cn(list.isPlaceholderData && "opacity-60")}>
            {days.map((d) => (
              <section key={d.key}>
                <h2 className="sticky top-14 z-10 border-b bg-muted/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">{formatDateLong(d.at)}</h2>
                <ol className="divide-y">
                  {d.items.map((e) => (
                    <li key={e.id} className="px-4 py-3">
                      <AuditEntryView entry={e} showSubject />
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
              <span>
                {tr("แสดง")} <span className="num text-foreground">{items.length.toLocaleString(LOCALE)}</span> {tr("จาก")} <span className="num text-foreground">{total.toLocaleString(LOCALE)}</span> {tr("รายการ")}
              </span>
              {items.length < total ? (
                <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)} disabled={list.isFetching}>
                  {list.isFetching ? <Spinner /> : null} {tr("โหลดเพิ่ม")}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
