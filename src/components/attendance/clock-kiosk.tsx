"use client";
/**
 * Time clock (ลงเวลาเข้า-ออกงาน): employees tap their own name, then "เข้างาน" / "ออกงาน". Works without logging in
 * (attendance.board / attendance.clock are public), so the shop PC can sit on the login screen.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, Clock, LogIn, LogOut, TriangleAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LEAVE_TYPE_LABELS, type ClockBoardRow, type ClockResult } from "@shared/contract";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { formatDateLong, formatDateStr, formatTime } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const BOARD_KEY = ["attendance", "board"] as const;

function useClockNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const secondsFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function StatusLine({ row }: { row: ClockBoardRow }) {
  if (row.status === "in") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-income">
        <span className="size-2 rounded-full bg-income" /> {tr("ทำงานอยู่ · เข้า")} <span className="num">{formatTime(row.since!)}</span>
      </span>
    );
  }
  if (row.status === "done") {
    return (
      <span className="text-sm text-muted-foreground">
        {tr("เลิกงานแล้ว ·")} <span className="num">{formatTime(row.firstIn!)}</span>–<span className="num">{row.lastOut ? formatTime(row.lastOut) : "—"}</span>
      </span>
    );
  }
  if (row.status === "leave") return <span className="text-sm font-medium text-warning-foreground dark:text-warning">{tr("{0}วันนี้", LEAVE_TYPE_LABELS[row.leave!])}</span>;
  return <span className="text-sm text-muted-foreground">{tr("ยังไม่ลงเวลาเข้างาน")}</span>;
}

export function ClockKiosk() {
  const now = useClockNow();
  const qc = useQueryClient();
  const board = useQuery({ queryKey: BOARD_KEY, queryFn: () => api.attendance.board(), refetchInterval: 30_000 });
  const [picked, setPicked] = useState<ClockBoardRow | null>(null);

  const rows = board.data?.rows ?? [];
  const inCount = rows.filter((r) => r.status === "in").length;

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="app-drag mac-traffic-pad flex flex-wrap items-center gap-4 border-b bg-card px-5 py-3 md:px-8">
        <Button asChild variant="outline" size="lg" className="shrink-0">
          <Link href="/" data-shot="clock-back">
            <ArrowLeft /> {tr("กลับ")}
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="hidden size-11 shrink-0 rounded-full bg-white shadow-sm ring-1 ring-foreground/10 sm:block" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{tr("ลงเวลาเข้า-ออกงาน")}</h1>
            <p className="truncate text-sm text-muted-foreground" suppressHydrationWarning>
              {tr("{0} · เวลาทำงาน {1}", formatDateLong(now), board.data ? tr("{0}–{1} น.", board.data.workStart, board.data.workEnd) : "…")}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="num text-4xl leading-none font-bold tracking-tight" suppressHydrationWarning data-shot="clock-now">
            {secondsFmt.format(now)}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {tr("ทำงานอยู่")} <span className="num font-medium text-foreground">{inCount}</span> {tr("/ {0} คน", rows.length)}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-5 md:p-8">
        <p className="mb-4 text-base text-muted-foreground">{tr("แตะที่ชื่อของคุณเพื่อลงเวลาเข้างานหรือออกงาน")}</p>
        {board.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : board.isError ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlert />
              </EmptyMedia>
              <EmptyTitle>{tr("โหลดรายชื่อไม่สำเร็จ")}</EmptyTitle>
              <EmptyDescription>{errorMessage(board.error)}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => void board.refetch()}>
                {tr("ลองอีกครั้ง")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty className="border py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                <UserPlus />
              </EmptyMedia>
              <EmptyTitle className="text-base">{tr("ยังไม่มีรายชื่อพนักงาน")}</EmptyTitle>
              <EmptyDescription>{tr("เจ้าของร้านเพิ่มพนักงานได้ที่เมนู “ข้อมูลพนักงาน” แล้วชื่อจะมาแสดงที่หน้านี้")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {rows.map((r) => (
              <button
                key={r.employeeId}
                type="button"
                role="listitem"
                onClick={() => setPicked(r)}
                className={cn(
                  "flex min-h-28 items-center gap-4 rounded-2xl border-2 bg-card px-5 py-4 text-left shadow-xs transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
                  r.status === "in" && "border-income/40 bg-income/5",
                )}
                data-shot="clock-tile"
              >
                <CustomerAvatar name={r.name} colorKey={r.employeeId} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-xl font-semibold">{r.name}</span>
                    {r.late ? <span className="shrink-0 rounded-full bg-warning/25 px-2 py-0.5 text-xs font-medium text-warning-foreground dark:text-warning">{tr("สาย")}</span> : null}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{r.position ?? r.fullName}</span>
                  <StatusLine row={r} />
                  {r.forgotOutDate ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                      <TriangleAlert className="size-3" /> {tr("ลืมลงเวลาออกเมื่อ {0}", formatDateStr(r.forgotOutDate))}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      <ClockDialog
        row={picked}
        onOpenChange={(o) => !o && setPicked(null)}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ["attendance"] });
        }}
      />
    </div>
  );
}

function ClockDialog({ row, onOpenChange, onDone }: { row: ClockBoardRow | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const now = useClockNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClockResult | null>(null);

  useEffect(() => {
    setError(null);
    setResult(null);
  }, [row?.employeeId]);

  // Close by itself a few seconds after a successful tap (the next person is waiting).
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => onOpenChange(false), 3500);
    return () => clearTimeout(t);
  }, [result, onOpenChange]);

  const clockingOut = row?.status === "in";

  const clock = async () => {
    if (!row || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.attendance.clock({ employeeId: row.employeeId }));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-shot="clock-dialog">
        {row ? (
          result ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CircleCheck className="size-16 text-income" />
              <DialogHeader className="items-center">
                <DialogTitle className="text-2xl">{result.action === "in" ? tr("ลงเวลาเข้างานแล้ว") : tr("ลงเวลาออกงานแล้ว")}</DialogTitle>
                <DialogDescription className="text-base">
                  {result.employeeName} · <span className="num">{tr("{0} น.", formatTime(result.at))}</span>
                </DialogDescription>
              </DialogHeader>
              {result.action === "in" && result.lateMinutes > 0 ? (
                <p className="rounded-lg bg-warning/15 px-3 py-1.5 text-sm text-warning-foreground dark:text-warning">{tr("มาสาย {0} นาที", result.lateMinutes)}</p>
              ) : null}
              {result.action === "out" && result.minutes != null ? (
                <p className="text-sm text-muted-foreground">
                  {tr("ทำงาน {0} ชม. {1} นาที", Math.floor(result.minutes / 60), result.minutes % 60)}
                </p>
              ) : null}
              <Button variant="outline" size="lg" className="mt-2" onClick={() => onOpenChange(false)}>
                {tr("ปิด")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <CustomerAvatar name={row.name} colorKey={row.employeeId} size="lg" className="size-20 text-3xl" />
              <DialogHeader className="items-center">
                <DialogTitle className="text-2xl">{row.name}</DialogTitle>
                <DialogDescription className="text-base">{row.position ?? row.fullName}</DialogDescription>
              </DialogHeader>
              <div className="num text-5xl font-bold tracking-tight" suppressHydrationWarning>
                {formatTime(now)}
              </div>
              {clockingOut ? (
                <p className="text-sm text-muted-foreground">
                  {tr("เข้างานตั้งแต่")} <span className="num">{tr("{0} น.", formatTime(row.since!))}</span>
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="w-full rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button
                size="lg"
                autoFocus
                className={cn("h-16 w-full text-xl", !clockingOut && "bg-success text-success-foreground hover:bg-success/85")}
                onClick={() => void clock()}
                disabled={busy}
                data-shot="clock-confirm"
              >
                {busy ? <Spinner /> : clockingOut ? <LogOut className="size-6" /> : <LogIn className="size-6" />}
                {clockingOut ? tr("ลงเวลาออกงาน") : tr("ลงเวลาเข้างาน")}
              </Button>
              <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => onOpenChange(false)}>
                <Clock className="mr-1 inline size-3.5" />
                {tr("ไม่ใช่ชื่อของฉัน")}
              </button>
            </div>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
