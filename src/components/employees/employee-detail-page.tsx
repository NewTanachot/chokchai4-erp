"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Banknote,
  CalendarPlus,
  Cake,
  Contact,
  CreditCard,
  IdCard,
  KeyRound,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  StickyNote,
  Trash2,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEAVE_TYPE_LABELS, PAY_TYPE_LABELS, type Employee } from "@shared/contract";
import { EntityHistoryCard } from "@/components/audit/entity-history";
import { MonthPicker, monthBounds, monthOf } from "@/components/attendance/month-picker";
import { LeaveDialog, SessionDialog, type LeaveTarget, type SessionTarget } from "@/components/attendance/session-dialogs";
import { StatsTiles } from "@/components/attendance/stats";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBaht, formatDateStr, formatDateStrShort, formatMinutes, formatTime } from "@/lib/format";
import { tr, trc } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { AdvanceDialog } from "./advance-dialog";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { durationText, formatNationalId, payRateText, yearsMonths } from "./employee-utils";

function BackLink() {
  return (
    <Link href="/employees/" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> {tr("พนักงานทั้งหมด")}
    </Link>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm break-words">{children ?? <span className="text-muted-foreground/70">{tr("ยังไม่มีข้อมูล")}</span>}</div>
      </div>
    </div>
  );
}

export function EmployeeDetailPage() {
  const id = useSearchParam("id");
  const router = useRouter();
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const q = useQuery({ queryKey: ["employees", "get", id], queryFn: () => api.employees.get(id!), enabled: !!id });
  const remove = useApiMutation(
    async () => {
      await api.employees.remove(id!);
      router.replace("/employees/");
    },
    { successMessage: tr("ลบพนักงานแล้ว") },
  );

  if (!id || q.isError) {
    const notFound = !id || (q.error instanceof ApiClientError && q.error.code === "NOT_FOUND");
    return (
      <>
        <BackLink />
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
              <UserX />
            </EmptyMedia>
            <EmptyTitle className="text-base">{notFound ? tr("ไม่พบพนักงาน") : tr("เปิดข้อมูลพนักงานไม่สำเร็จ")}</EmptyTitle>
            <EmptyDescription>{notFound ? tr("พนักงานคนนี้อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง") : errorMessage(q.error)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/employees/">{tr("กลับไปหน้าพนักงาน")}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }
  if (q.isPending) {
    return (
      <>
        <BackLink />
        <Skeleton className="mb-6 h-16 w-80" />
        <div className="grid gap-4 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </>
    );
  }
  const e = q.data;
  const age = e.birthDate ? yearsMonths(e.birthDate).years : null;

  return (
    <>
      <BackLink />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <CustomerAvatar name={e.displayName} colorKey={e.id} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{e.displayName}</h1>
              {e.isActive ? <Badge className="bg-income/12 text-income dark:bg-income/18">{tr("ทำงานอยู่")}</Badge> : <Badge variant="outline">{tr("ลาออกแล้ว")}</Badge>}
              {e.code ? <Badge variant="outline" className="num">{e.code}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {e.fullName}
              {e.position ? ` · ${e.position}` : ""}
              {e.startDate ? tr(" · ทำงานมา {0}", durationText(e.startDate, e.endDate ?? undefined)) : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => setAdvanceOpen(true)} data-shot="employee-advance">
            <Banknote /> {tr("บันทึกเบิกเงิน")}
          </Button>
          <Button size="lg" onClick={() => setEditOpen(true)} data-shot="edit-employee">
            <Pencil /> {tr("แก้ไขข้อมูล")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label={tr("เพิ่มเติม")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 /> {tr("ลบพนักงาน")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[21rem_minmax(0,1fr)]">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Card className="gap-0" data-shot="employee-pay">
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{tr("การทำงานและค่าจ้าง")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row icon={Banknote} label={PAY_TYPE_LABELS[e.payType]}>
                <span className="num text-base font-semibold">{payRateText(e.payType, e.payRate)}</span>
              </Row>
              <Row icon={ShieldCheck} label={tr("ประกันสังคม")}>{e.socialSecurity ? tr("หักประกันสังคม") : tr("ไม่หัก")}</Row>
              <Row icon={CreditCard} label={tr("บัญชีรับเงินเดือน")}>{e.bankAccount ? `${e.bankName ?? ""} ${e.bankAccount}`.trim() : null}</Row>
              <Row icon={CalendarPlus} label={tr("วันเริ่มงาน")}>
                {e.startDate ? formatDateStr(e.startDate) : null}
                {!e.isActive && e.endDate ? <span className="text-muted-foreground"> {tr("· ทำงานวันสุดท้าย {0}", formatDateStr(e.endDate))}</span> : null}
              </Row>
              <Row icon={KeyRound} label={tr("บัญชีเข้าใช้โปรแกรม")}>{e.userName ? e.userName : <span className="text-muted-foreground">{tr("ไม่มี (ลงเวลาได้อย่างเดียว)")}</span>}</Row>
            </CardContent>
          </Card>
          <Card className="gap-0" data-shot="employee-profile">
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{tr("ข้อมูลส่วนตัว")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row icon={Phone} label={tr("เบอร์โทร")}>{e.phone ? <span className="num">{e.phone}</span> : null}</Row>
              <Row icon={MessageCircle} label="LINE ID">{e.lineId}</Row>
              <Row icon={IdCard} label={tr("เลขบัตรประชาชน")}>{e.nationalId ? <span className="num">{formatNationalId(e.nationalId)}</span> : null}</Row>
              <Row icon={Cake} label={tr("วันเกิด")}>{e.birthDate ? tr("{0} (อายุ {1} ปี)", formatDateStr(e.birthDate), age) : null}</Row>
              <Row icon={MapPin} label={tr("ที่อยู่")}>{e.address ? <span className="whitespace-pre-line">{e.address}</span> : null}</Row>
              <Row icon={Contact} label={tr("ผู้ติดต่อกรณีฉุกเฉิน")}>{e.emergencyName || e.emergencyPhone ? [e.emergencyName, e.emergencyPhone].filter(Boolean).join(" · ") : null}</Row>
              {e.note ? (
                <Row icon={StickyNote} label={tr("หมายเหตุ")}>
                  <span className="whitespace-pre-line">{e.note}</span>
                </Row>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="attendance" className="min-w-0">
          <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-fit">
            <TabsTrigger value="attendance" className="px-3">
              {tr("เวลาทำงาน")}
            </TabsTrigger>
            <TabsTrigger value="advances" className="px-3">
              {tr("เบิกเงิน")}
            </TabsTrigger>
            <TabsTrigger value="payslips" className="px-3">
              {trc("plural", "สลิปเงินเดือน")}
            </TabsTrigger>
            {can("audit.view") ? (
              <TabsTrigger value="history" className="px-3">
                {tr("ประวัติการแก้ไข")}
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent value="attendance">
            <EmployeeAttendance employee={e} />
          </TabsContent>
          <TabsContent value="advances">
            <EmployeeAdvances employee={e} onAdd={() => setAdvanceOpen(true)} />
          </TabsContent>
          <TabsContent value="payslips">
            <EmployeePayslips employeeId={e.id} />
          </TabsContent>
          {can("audit.view") ? (
            <TabsContent value="history">
              <EntityHistoryCard entityType="employee" entityId={e.id} description={tr("การแก้ไขข้อมูลพนักงานและอัตราค่าจ้าง")} />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

      <EmployeeFormDialog open={editOpen} onOpenChange={setEditOpen} employee={e} />
      <AdvanceDialog employee={advanceOpen ? e : null} onOpenChange={setAdvanceOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tr("ลบพนักงาน “{0}”?", e.displayName)}
        description={tr("ถ้าพนักงานลาออก แนะนำให้แก้ไขเป็น “ลาออกแล้ว” แทนการลบ — เวลาทำงานและสลิปเงินเดือนเดิมยังเก็บไว้")}
        confirmText={tr("ลบพนักงาน")}
        destructive
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function EmployeeAttendance({ employee: e }: { employee: Employee }) {
  const { can } = useAuth();
  const [month, setMonth] = useState(monthOf());
  const [session, setSession] = useState<SessionTarget | null>(null);
  const [leave, setLeave] = useState<LeaveTarget | null>(null);
  const { from, to } = monthBounds(month);
  const records = useQuery({ queryKey: ["attendance", "list", { from, to, employeeId: e.id }], queryFn: () => api.attendance.list({ from, to, employeeId: e.id }), placeholderData: keepPreviousData });
  const leaves = useQuery({ queryKey: ["attendance", "leaves", { from, to, employeeId: e.id }], queryFn: () => api.attendance.leaves({ from, to, employeeId: e.id }), placeholderData: keepPreviousData });
  const summary = useQuery({ queryKey: ["attendance", "summary", { from, to, includeInactive: true }], queryFn: () => api.attendance.summary({ from, to, includeInactive: true }), placeholderData: keepPreviousData });
  const stats = summary.data?.find((r) => r.employeeId === e.id)?.stats;
  const canEdit = can("attendance.manage") || can("employees.manage");

  // One list of days: sessions and leaves, newest first.
  const rows = [
    ...(records.data ?? []).map((r) => ({ kind: "session" as const, date: r.workDate, at: r.clockIn, r })),
    ...(leaves.data ?? []).map((l) => ({ kind: "leave" as const, date: l.date, at: 0, l })),
  ].sort((a, b) => (a.date === b.date ? b.at - a.at : a.date < b.date ? 1 : -1));

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <MonthPicker value={month} onChange={setMonth} />
        {canEdit ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLeave({ leave: null, employeeId: e.id })}>
              <CalendarPlus /> {tr("บันทึกวันลา")}
            </Button>
            <Button variant="outline" onClick={() => setSession({ record: null, employeeId: e.id })}>
              <Plus /> {tr("เพิ่มเวลาทำงาน")}
            </Button>
          </div>
        ) : null}
      </div>
      {stats ? <StatsTiles stats={stats} className="border-b p-3" /> : <Skeleton className="m-3 h-16" />}
      {records.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">{tr("ไม่มีการลงเวลาในเดือนนี้")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">{tr("วันที่")}</TableHead>
              <TableHead>{tr("เข้า")}</TableHead>
              <TableHead>{tr("ออก")}</TableHead>
              <TableHead className="text-right">{tr("ชั่วโมง")}</TableHead>
              <TableHead className="pr-4">{tr("หมายเหตุ")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((x) =>
              x.kind === "leave" ? (
                <TableRow key={`l-${x.l.id}`} className={cn(canEdit && "cursor-pointer")} onClick={() => canEdit && setLeave({ leave: x.l })}>
                  <TableCell className="pl-4">{formatDateStrShort(x.date)}</TableCell>
                  <TableCell colSpan={3}>
                    <Badge variant="outline" className="border-warning/50 bg-warning/10">
                      {LEAVE_TYPE_LABELS[x.l.type]}
                      {x.l.halfDay ? tr(" (ครึ่งวัน)") : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">{x.l.note}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={x.r.id} className={cn(canEdit && "cursor-pointer")} onClick={() => canEdit && setSession({ record: x.r })}>
                  <TableCell className="pl-4">{formatDateStrShort(x.date)}</TableCell>
                  <TableCell className="num">
                    {formatTime(x.r.clockIn)}
                    {x.r.lateMinutes ? <span className="ml-1.5 text-xs text-warning-foreground dark:text-warning">{tr("สาย {0} น.", x.r.lateMinutes)}</span> : null}
                  </TableCell>
                  <TableCell className="num">{x.r.clockOut ? formatTime(x.r.clockOut) : <span className="text-xs text-destructive">{tr("ไม่ได้ลงเวลาออก")}</span>}</TableCell>
                  <TableCell className="num text-right">{x.r.minutes != null ? formatMinutes(x.r.minutes) : "—"}</TableCell>
                  <TableCell className="max-w-56 truncate pr-4 text-muted-foreground">
                    {x.r.source === "manual" ? <Badge variant="outline" className="mr-1.5">{tr("แก้ไขโดย {0}", x.r.createdByName ?? tr("ระบบ"))}</Badge> : null}
                    {x.r.note}
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
      <SessionDialog target={session} onOpenChange={(o) => !o && setSession(null)} />
      <LeaveDialog target={leave} onOpenChange={(o) => !o && setLeave(null)} />
    </Card>
  );
}

function EmployeeAdvances({ employee: e, onAdd }: { employee: Employee; onAdd: () => void }) {
  const q = useQuery({ queryKey: ["payroll", "advances", { employeeId: e.id }], queryFn: () => api.payroll.listAdvances({ employeeId: e.id, limit: 200 }) });
  const [deleting, setDeleting] = useState<string | null>(null);
  const remove = useApiMutation((id: string) => api.payroll.removeAdvance(id), { successMessage: tr("ลบรายการเบิกเงินแล้ว"), onSettled: () => setDeleting(null) });
  const items = q.data?.items ?? [];
  const outstanding = items.filter((a) => !a.payslipId).reduce((s, a) => s + a.amount, 0);
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="text-sm">
          {tr("ยอดที่ยังไม่ได้หัก")} <span className={cn("num font-semibold", outstanding > 0 && "text-expense")}>{formatBaht(outstanding)}</span>
        </div>
        <Button variant="outline" onClick={onAdd}>
          <Plus /> {tr("บันทึกเบิกเงิน")}
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="m-4 h-24" />
      ) : items.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">{tr("ยังไม่เคยเบิกเงินล่วงหน้า")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">{tr("วันที่เบิก")}</TableHead>
              <TableHead className="text-right">{tr("จำนวนเงิน")}</TableHead>
              <TableHead>{tr("สถานะ")}</TableHead>
              <TableHead>{tr("หมายเหตุ")}</TableHead>
              <TableHead className="w-12 pr-3" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="pl-4">{formatDateStr(a.date)}</TableCell>
                <TableCell className="num text-right font-medium">{formatBaht(a.amount)}</TableCell>
                <TableCell>
                  {!a.payslipId ? (
                    <Badge variant="outline" className="border-warning/50 bg-warning/10">
                      {tr("รอหักงวดถัดไป")}
                    </Badge>
                  ) : (
                    <Link href={`/payroll/view/?id=${a.runId}`} className="text-sm text-primary hover:underline">
                      {tr("{0}ใน {1}", a.settled ? tr("หักแล้ว") : tr("จะหัก"), a.runTitle)}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{a.note}</TableCell>
                <TableCell className="pr-3">
                  {!a.settled ? (
                    <Button variant="ghost" size="icon" aria-label={tr("ลบรายการเบิก")} onClick={() => setDeleting(a.id)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={tr("ลบรายการเบิกเงินนี้?")}
        description={tr("ถ้าอยู่ในสลิปที่ยังไม่จ่าย ยอดหักในสลิปจะปรับตามให้")}
        confirmText={tr("ลบ")}
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
      />
    </Card>
  );
}

function EmployeePayslips({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ["payroll", "employeePayslips", employeeId], queryFn: () => api.payroll.employeePayslips({ employeeId, limit: 100 }) });
  const items = q.data?.items ?? [];
  return (
    <Card className="gap-0 py-0">
      {q.isPending ? (
        <Skeleton className="m-4 h-24" />
      ) : items.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">{tr("ยังไม่มีสลิปเงินเดือน — สร้างได้ที่เมนู “เงินเดือน”")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">{tr("งวด")}</TableHead>
              <TableHead className="text-right">{tr("รายได้")}</TableHead>
              <TableHead className="text-right">{tr("รายการหัก")}</TableHead>
              <TableHead className="text-right">{tr("รับสุทธิ")}</TableHead>
              <TableHead className="pr-4">{tr("สถานะ")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4">
                  <Link href={`/payroll/view/?id=${p.runId}`} className="font-medium text-primary hover:underline">
                    {p.runTitle}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatDateStr(p.periodStart)} – {formatDateStr(p.periodEnd)}
                  </div>
                </TableCell>
                <TableCell className="num text-right">{formatBaht(p.earnings)}</TableCell>
                <TableCell className="num text-right text-expense">{p.deductions ? `−${formatBaht(p.deductions)}` : "—"}</TableCell>
                <TableCell className="num text-right font-semibold">{formatBaht(p.net)}</TableCell>
                <TableCell className="pr-4">
                  {p.status === "paid" ? <Badge className="bg-success/15 text-success">{tr("จ่ายแล้ว")}</Badge> : <Badge variant="outline">{tr("ยังไม่จ่าย")}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
