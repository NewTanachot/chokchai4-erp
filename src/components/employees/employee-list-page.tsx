"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Banknote, CalendarClock, Contact, KeyRound, MoreHorizontal, Pencil, Plus, Search, SearchX, Trash2, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Employee, EmployeeListQuery } from "@shared/contract";
import { FilterChip, useDebouncedValue } from "@/components/catalog/shared";
import { StatCard } from "@/components/catalog/stat-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { formatBaht } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { AdvanceDialog } from "./advance-dialog";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { durationText, payRateText } from "./employee-utils";

type Status = NonNullable<EmployeeListQuery["status"]>;
const STATUS: { id: Status; label: string }[] = [
  { id: "active", label: tr("ทำงานอยู่") },
  { id: "resigned", label: tr("ลาออกแล้ว") },
  { id: "all", label: tr("ทั้งหมด") },
];

export function EmployeeListPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const [status, setStatus] = useState<Status>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [advanceFor, setAdvanceFor] = useState<Employee | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const query: EmployeeListQuery = { search: debounced || undefined, status, limit: 500 };
  const list = useQuery({ queryKey: ["employees", "list", query], queryFn: () => api.employees.list(query), placeholderData: keepPreviousData });
  const active = useQuery({ queryKey: ["employees", "list", { status: "active", limit: 500 }], queryFn: () => api.employees.list({ status: "active", limit: 500 }) });
  const remove = useApiMutation((id: string) => api.employees.remove(id), { successMessage: tr("ลบพนักงานแล้ว"), onSettled: () => setDeleting(null) });

  const items = list.data?.items ?? [];
  const staff = active.data?.items ?? [];
  const monthlyTotal = staff.filter((e) => e.payType === "monthly").reduce((s, e) => s + e.payRate, 0);
  const daily = staff.filter((e) => e.payType === "daily");
  const dailyTotal = daily.reduce((s, e) => s + e.payRate, 0);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <>
      <PageHeader
        title={tr("ข้อมูลพนักงาน")}
        description={tr("ข้อมูลส่วนตัว ตำแหน่ง และอัตราค่าจ้างของพนักงานทุกคน")}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href="/attendance/">
                <CalendarClock /> {tr("เวลาทำงาน")}
              </Link>
            </Button>
            <Button size="lg" onClick={openCreate} data-shot="new-employee">
              <Plus /> {tr("เพิ่มพนักงาน")}
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label={tr("พนักงานที่ทำงานอยู่")}
          loading={active.isPending}
          value={
            <>
              {staff.length.toLocaleString(LOCALE)} <span className="text-base font-normal text-muted-foreground">{tr("คน")}</span>
            </>
          }
          sub={tr("รายเดือน {0} · รายวัน {1}", staff.length - daily.length, daily.length)}
        />
        <StatCard icon={Wallet} tone="success" label={tr("เงินเดือนรวม (รายเดือน)")} loading={active.isPending} value={formatBaht(monthlyTotal)} sub={tr("ต่อเดือน ก่อนหักรายการ")} />
        <StatCard icon={Banknote} label={tr("ค่าแรงรวม (รายวัน)")} loading={active.isPending} value={formatBaht(dailyTotal)} sub={tr("ต่อวัน ถ้ามาทำงานครบทุกคน")} />
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:p-4">
          <InputGroup className="h-10 min-w-56 flex-1 bg-background dark:bg-input/30">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("ค้นหาชื่อ ชื่อเล่น ตำแหน่ง หรือเบอร์โทร")}
              aria-label={tr("ค้นหาพนักงาน")}
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
          <div className="flex gap-2" role="group" aria-label={tr("สถานะ")}>
            {STATUS.map((s) => (
              <FilterChip key={s.id} active={status === s.id} onClick={() => setStatus(s.id)}>
                {s.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {list.isError ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertTriangle />
              </EmptyMedia>
              <EmptyTitle>{tr("โหลดรายชื่อพนักงานไม่สำเร็จ")}</EmptyTitle>
              <EmptyDescription>{errorMessage(list.error)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : list.isPending ? (
          <div className="divide-y">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                {debounced ? <SearchX /> : <Contact />}
              </EmptyMedia>
              <EmptyTitle className="text-base">{debounced ? tr("ไม่พบพนักงานที่ตรงกับ “{0}”", debounced) : status === "resigned" ? tr("ไม่มีพนักงานที่ลาออก") : tr("ยังไม่มีข้อมูลพนักงาน")}</EmptyTitle>
              <EmptyDescription>{tr("เพิ่มพนักงานพร้อมเงินเดือนหรือค่าแรงรายวัน แล้วพนักงานจะลงเวลาเข้า-ออกงานได้ทันที")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="lg" onClick={openCreate}>
                <Plus /> {tr("เพิ่มพนักงาน")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table className={cn(list.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">{tr("พนักงาน")}</TableHead>
                <TableHead className="hidden lg:table-cell">{tr("เบอร์โทร")}</TableHead>
                <TableHead className="text-right">{tr("ค่าจ้าง")}</TableHead>
                <TableHead className="hidden md:table-cell">{tr("อายุงาน")}</TableHead>
                <TableHead className="w-12 pr-3">
                  <span className="sr-only">{tr("จัดการ")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <TableRow key={e.id} className={cn("cursor-pointer", !e.isActive && "text-muted-foreground")} onClick={() => router.push(`/employees/view/?id=${e.id}`)}>
                  <TableCell className="py-2.5 pl-4">
                    <div className="flex items-center gap-3">
                      <CustomerAvatar name={e.displayName} colorKey={e.id} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/employees/view/?id=${e.id}`} className="font-semibold text-foreground hover:underline" onClick={(ev) => ev.stopPropagation()}>
                            {e.displayName}
                          </Link>
                          {!e.isActive ? <Badge variant="outline">{tr("ลาออกแล้ว")}</Badge> : null}
                          {e.userName ? (
                            <Badge variant="secondary" className="gap-1" title={tr("มีบัญชีเข้าใช้โปรแกรม")}>
                              <KeyRound /> {e.userName}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.fullName}
                          {e.position ? ` · ${e.position}` : ""}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="num hidden lg:table-cell">{e.phone ?? "—"}</TableCell>
                  <TableCell className="num text-right font-medium">{payRateText(e.payType, e.payRate)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{e.startDate ? durationText(e.startDate, e.endDate ?? undefined) : "—"}</TableCell>
                  <TableCell className="pr-3" onClick={(ev) => ev.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={tr("จัดการ {0}", e.displayName)}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(e);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil /> {tr("แก้ไขข้อมูล")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAdvanceFor(e)}>
                          <Banknote /> {tr("บันทึกเบิกเงิน")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(e)}>
                          <Trash2 /> {tr("ลบ")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <EmployeeFormDialog open={formOpen} onOpenChange={setFormOpen} employee={editing} onSaved={(e) => !editing && router.push(`/employees/view/?id=${e.id}`)} />
      <AdvanceDialog employee={advanceFor} onOpenChange={(o) => !o && setAdvanceFor(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={tr("ลบพนักงาน “{0}”?", deleting?.displayName ?? "")}
        description={tr("ถ้าพนักงานลาออก แนะนำให้แก้ไขเป็น “ลาออกแล้ว” แทนการลบ — การลบจะซ่อนรายชื่อนี้ แต่เวลาทำงานและสลิปเงินเดือนเดิมยังเก็บไว้")}
        confirmText={tr("ลบพนักงาน")}
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </>
  );
}
