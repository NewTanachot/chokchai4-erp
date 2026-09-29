"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarPlus, Clock, Plus, Settings2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LEAVE_TYPE_LABELS, type AttendanceSummaryRow, type ClockBoardRow } from "@shared/contract";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatDateStr, formatDateStrShort, formatMinutes, formatTime } from "@/lib/format";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MonthPicker, monthBounds, monthOf } from "./month-picker";
import { LeaveDialog, SessionDialog, type LeaveTarget, type SessionTarget } from "./session-dialogs";
import { StatsTiles } from "./stats";

const days = (n: number) => n.toLocaleString(LOCALE, { maximumFractionDigits: 1 });

function TodayStatus({ row }: { row: ClockBoardRow }) {
  if (row.status === "in") return <Badge className="bg-income/12 text-income dark:bg-income/18">{tr("ทำงานอยู่")}</Badge>;
  if (row.status === "done") return <Badge variant="secondary">{tr("เลิกงานแล้ว")}</Badge>;
  if (row.status === "leave") return <Badge className="bg-warning/20 text-warning-foreground dark:text-warning">{LEAVE_TYPE_LABELS[row.leave!]}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{tr("ยังไม่มา")}</Badge>;
}

export function AttendancePage() {
  const { can } = useAuth();
  const [month, setMonth] = useState(monthOf());
  const [session, setSession] = useState<SessionTarget | null>(null);
  const [leave, setLeave] = useState<LeaveTarget | null>(null);
  const [detail, setDetail] = useState<AttendanceSummaryRow | null>(null);
  const { from, to } = monthBounds(month);

  const board = useQuery({ queryKey: ["attendance", "board"], queryFn: () => api.attendance.board(), refetchInterval: 60_000 });
  const summary = useQuery({
    queryKey: ["attendance", "summary", { from, to, includeInactive: true }],
    queryFn: () => api.attendance.summary({ from, to, includeInactive: true }),
    placeholderData: keepPreviousData,
  });
  const rows = board.data?.rows ?? [];
  const forgot = rows.filter((r) => r.forgotOutDate);

  return (
    <>
      <PageHeader
        title={tr("เวลาทำงาน")}
        description={tr("ใครมาทำงานวันนี้ สรุปมาสาย ขาด ลา ของแต่ละเดือน และแก้ไขเวลาที่ลงผิด")}
        actions={
          <>
            {can("employees.manage") ? (
              <Button asChild variant="ghost" size="lg">
                <Link href="/settings/?section=payroll">
                  <Settings2 /> {tr("ตั้งเวลางาน")}
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" size="lg" onClick={() => setLeave({ leave: null })} data-shot="add-leave">
              <CalendarPlus /> {tr("บันทึกวันลา")}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setSession({ record: null })} data-shot="add-session">
              <Plus /> {tr("เพิ่มเวลาทำงาน")}
            </Button>
            <Button asChild size="lg">
              <Link href="/clock/">
                <Clock /> {tr("หน้าลงเวลา")}
              </Link>
            </Button>
          </>
        }
      />

      {forgot.length ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            <b>{tr("ลืมลงเวลาออก:")}</b> {tr("{0} — เปิดดูรายเดือนของพนักงานคนนั้นแล้วแก้เวลาออกให้ถูกต้อง", forgot.map((r) => `${r.name} (${formatDateStr(r.forgotOutDate)})`).join(", "))}
          </p>
        </div>
      ) : null}

      <Card className="mb-5 gap-0 py-0" data-shot="attendance-today">
        <CardHeader className="border-b py-4">
          <CardTitle>{tr("วันนี้")}</CardTitle>
          <CardDescription suppressHydrationWarning>
            {tr("{0} · เวลาทำงาน {1}", formatDateLong(Date.now()), board.data ? tr("{0}–{1} น.", board.data.workStart, board.data.workEnd) : "…")}
          </CardDescription>
        </CardHeader>
        {board.isPending ? (
          <Skeleton className="m-4 h-24" />
        ) : board.isError ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(board.error)}</p>
        ) : rows.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyTitle className="text-base">{tr("ยังไม่มีพนักงาน")}</EmptyTitle>
              <EmptyDescription>{tr("เพิ่มพนักงานที่เมนู “ข้อมูลพนักงาน” ก่อน แล้วพนักงานจะลงเวลาได้ที่หน้าลงเวลา")}</EmptyDescription>
            </EmptyHeader>
            {can("employees.manage") ? (
              <EmptyContent>
                <Button asChild>
                  <Link href="/employees/">{tr("ไปที่ข้อมูลพนักงาน")}</Link>
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <div key={r.employeeId} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <CustomerAvatar name={r.name} colorKey={r.employeeId} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{r.name}</span>
                    <TodayStatus row={r} />
                    {r.late ? <Badge className="bg-warning/20 text-warning-foreground dark:text-warning">{tr("สาย")}</Badge> : null}
                  </div>
                  <div className="num text-sm text-muted-foreground">
                    {r.firstIn ? tr("เข้า {0}", formatTime(r.firstIn)) : "—"}
                    {r.lastOut && r.status !== "in" ? tr(" · ออก {0}", formatTime(r.lastOut)) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="gap-0 py-0" data-shot="attendance-month">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-semibold">{tr("สรุปรายเดือน")}</h2>
            <p className="text-sm text-muted-foreground">{tr("คลิกชื่อพนักงานเพื่อดูและแก้ไขเวลารายวัน")}</p>
          </div>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
        {summary.isPending ? (
          <Skeleton className="m-4 h-40" />
        ) : summary.isError ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(summary.error)}</p>
        ) : !summary.data.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{tr("ไม่มีพนักงานในเดือนนี้")}</p>
        ) : (
          <Table className={cn(summary.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">{tr("พนักงาน")}</TableHead>
                <TableHead className="text-right">{tr("มาทำงาน")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{trc("plural", "ชั่วโมง")}</TableHead>
                <TableHead className="text-right">{tr("สาย")}</TableHead>
                <TableHead className="text-right">{tr("ขาด")}</TableHead>
                <TableHead className="text-right">{tr("ลา")}</TableHead>
                <TableHead className="hidden pr-4 text-right lg:table-cell">OT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.data.map((r) => {
                const s = r.stats;
                return (
                  <TableRow key={r.employeeId} className="cursor-pointer" onClick={() => setDetail(r)}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2.5">
                        <CustomerAvatar name={r.name} colorKey={r.employeeId} size="sm" />
                        <div>
                          <div className="font-medium">
                            {r.name}
                            {!r.isActive ? <span className="ml-1.5 text-xs text-muted-foreground">{tr("(ลาออก)")}</span> : null}
                            {s.forgotOutCount ? <TriangleAlert className="ml-1.5 inline size-3.5 text-destructive" aria-label={tr("ลืมลงเวลาออก")} /> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">{r.position ?? r.fullName}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="num text-right">
                      {days(s.daysWorked)} <span className="text-xs text-muted-foreground">{tr("/ {0} วัน", s.workDays)}</span>
                    </TableCell>
                    <TableCell className="num hidden text-right md:table-cell">{formatMinutes(s.minutesWorked)}</TableCell>
                    <TableCell className={cn("num text-right", s.lateCount && "text-warning-foreground dark:text-warning")}>
                      {s.lateCount ? tr("{0} ครั้ง", s.lateCount) : "—"}
                      {s.lateMinutes ? <div className="text-xs text-muted-foreground">{tr("{0} นาที", s.lateMinutes)}</div> : null}
                    </TableCell>
                    <TableCell className={cn("num text-right", s.absentDays && "text-destructive")}>{s.absentDays ? tr("{0} วัน", days(s.absentDays)) : "—"}</TableCell>
                    <TableCell className="num text-right">{s.paidLeaveDays + s.unpaidLeaveDays ? tr("{0} วัน", days(s.paidLeaveDays + s.unpaidLeaveDays)) : "—"}</TableCell>
                    <TableCell className="num hidden pr-4 text-right lg:table-cell">{s.otMinutes ? formatMinutes(s.otMinutes) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <EmployeeMonthDialog row={detail} month={month} onOpenChange={(o) => !o && setDetail(null)} onEditSession={setSession} onEditLeave={setLeave} />
      <SessionDialog target={session} onOpenChange={(o) => !o && setSession(null)} />
      <LeaveDialog target={leave} onOpenChange={(o) => !o && setLeave(null)} />
    </>
  );
}

/** One employee's month: tiles + each day's sessions and leaves, click to correct. */
function EmployeeMonthDialog({
  row,
  month,
  onOpenChange,
  onEditSession,
  onEditLeave,
}: {
  row: AttendanceSummaryRow | null;
  month: string;
  onOpenChange: (o: boolean) => void;
  onEditSession: (t: SessionTarget) => void;
  onEditLeave: (t: LeaveTarget) => void;
}) {
  const { from, to } = monthBounds(month);
  const employeeId = row?.employeeId ?? "";
  const records = useQuery({ queryKey: ["attendance", "list", { from, to, employeeId }], queryFn: () => api.attendance.list({ from, to, employeeId }), enabled: !!row });
  const leaves = useQuery({ queryKey: ["attendance", "leaves", { from, to, employeeId }], queryFn: () => api.attendance.leaves({ from, to, employeeId }), enabled: !!row });
  const summary = useQuery({ queryKey: ["attendance", "summary", { from, to, includeInactive: true }], queryFn: () => api.attendance.summary({ from, to, includeInactive: true }), enabled: !!row });
  const stats = summary.data?.find((r) => r.employeeId === employeeId)?.stats ?? row?.stats;
  const list = [
    ...(records.data ?? []).map((r) => ({ key: r.id, date: r.workDate, at: r.clockIn, r, l: null })),
    ...(leaves.data ?? []).map((l) => ({ key: l.id, date: l.date, at: 0, r: null, l })),
  ].sort((a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1));

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-3xl" data-shot="employee-month">
        <DialogHeader>
          <DialogTitle>{tr("{0} — เวลาทำงานเดือนนี้", row?.name)}</DialogTitle>
          <DialogDescription>
            {tr("{0} – {1} · คลิกรายการเพื่อแก้ไข", formatDateStr(from), formatDateStr(to))}
          </DialogDescription>
        </DialogHeader>
        {stats ? <StatsTiles stats={stats} /> : null}
        <div className="-mx-4 overflow-y-auto px-4">
          {records.isPending ? (
            <Skeleton className="h-40" />
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{tr("ไม่มีการลงเวลาในเดือนนี้")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("วันที่")}</TableHead>
                  <TableHead>{tr("เข้า")}</TableHead>
                  <TableHead>{tr("ออก")}</TableHead>
                  <TableHead className="text-right">{trc("plural", "ชั่วโมง")}</TableHead>
                  <TableHead>{tr("หมายเหตุ")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((x) =>
                  x.l ? (
                    <TableRow key={x.key} className="cursor-pointer" onClick={() => onEditLeave({ leave: x.l })}>
                      <TableCell>{formatDateStrShort(x.date)}</TableCell>
                      <TableCell colSpan={3}>
                        <Badge variant="outline" className="border-warning/50 bg-warning/10">
                          {LEAVE_TYPE_LABELS[x.l.type]}
                          {x.l.halfDay ? tr(" (ครึ่งวัน)") : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{x.l.note}</TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={x.key} className="cursor-pointer" onClick={() => onEditSession({ record: x.r })}>
                      <TableCell>{formatDateStrShort(x.date)}</TableCell>
                      <TableCell className="num">
                        {formatTime(x.r!.clockIn)}
                        {x.r!.lateMinutes ? <span className="ml-1.5 text-xs text-warning-foreground dark:text-warning">{tr("สาย {0} น.", x.r!.lateMinutes)}</span> : null}
                      </TableCell>
                      <TableCell className="num">{x.r!.clockOut ? formatTime(x.r!.clockOut) : <span className="text-xs text-destructive">{tr("ไม่ได้ลงเวลาออก")}</span>}</TableCell>
                      <TableCell className="num text-right">{x.r!.minutes != null ? formatMinutes(x.r!.minutes) : "—"}</TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {x.r!.source === "manual" ? tr("แก้ไขโดย {0} ", x.r!.createdByName ?? tr("ระบบ")) : ""}
                        {x.r!.note}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )}
          <div className="flex gap-2 py-3">
            <Button variant="outline" onClick={() => onEditSession({ record: null, employeeId })}>
              <Plus /> {tr("เพิ่มเวลาทำงาน")}
            </Button>
            <Button variant="outline" onClick={() => onEditLeave({ leave: null, employeeId })}>
              <CalendarPlus /> {tr("บันทึกวันลา")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
