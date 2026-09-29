"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarX, CircleCheck, FileText, MoreHorizontal, Pencil, Printer, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PAY_METHOD_LABELS, type Payslip } from "@shared/contract";
import { EntityHistoryCard } from "@/components/audit/entity-history";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBaht, formatDate, formatDateStr } from "@/lib/format";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { PayDialog, PayslipPrintDialog } from "./pay-dialogs";
import { PayslipEditor } from "./payslip-editor";

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "income" | "expense" }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn("num mt-0.5 text-xl font-semibold", tone === "income" && "text-income", tone === "expense" && "text-expense")}>{value}</div>
    </div>
  );
}

export function RunDetailPage() {
  const id = useSearchParam("id");
  const router = useRouter();
  const { can } = useAuth();
  const [editing, setEditing] = useState<string | null>(null);
  const [paying, setPaying] = useState<Payslip[] | null>(null);
  const [printing, setPrinting] = useState<Payslip | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removingSlip, setRemovingSlip] = useState<Payslip | null>(null);
  const run = useQuery({ queryKey: ["payroll", "run", id], queryFn: () => api.payroll.getRun(id!), enabled: !!id });
  const removeRun = useApiMutation(
    async () => {
      await api.payroll.removeRun(id!);
      router.replace("/payroll/");
    },
    { successMessage: tr("ลบงวดเงินเดือนแล้ว") },
  );
  const removeSlip = useApiMutation((pid: string) => api.payroll.removePayslip(pid), { successMessage: tr("นำพนักงานออกจากงวดแล้ว"), onSettled: () => setRemovingSlip(null) });

  if (!id || run.isError) {
    const notFound = !id || (run.error instanceof ApiClientError && run.error.code === "NOT_FOUND");
    return (
      <Empty className="mt-10 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX />
          </EmptyMedia>
          <EmptyTitle className="text-base">{notFound ? tr("ไม่พบงวดเงินเดือนนี้") : tr("เปิดงวดเงินเดือนไม่สำเร็จ")}</EmptyTitle>
          <EmptyDescription>{notFound ? tr("งวดนี้อาจถูกลบไปแล้ว") : errorMessage(run.error)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href="/payroll/">{tr("ไปที่หน้าเงินเดือน")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (run.isPending) {
    return (
      <>
        <Skeleton className="mb-5 h-16 w-96" />
        <Skeleton className="h-80 rounded-xl" />
      </>
    );
  }
  const r = run.data;
  const unpaid = r.payslips.filter((p) => p.status === "unpaid");
  const hasPaid = r.paidCount > 0;

  return (
    <>
      <Link href="/payroll/" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {tr("งวดเงินเดือนทั้งหมด")}
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
            {r.payslipCount && r.paidCount === r.payslipCount ? (
              <Badge className="bg-success/15 text-success">{tr("จ่ายครบแล้ว")}</Badge>
            ) : (
              <Badge variant="outline">
                {tr("จ่ายแล้ว {0}/{1}", r.paidCount, r.payslipCount)}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateStr(r.periodStart)} – {formatDateStr(r.periodEnd)}
            {r.createdByName ? tr(" · สร้างโดย {0} เมื่อ {1}", r.createdByName, formatDate(r.createdAt)) : ""}
          </p>
          {r.note ? <p className="mt-1 text-sm">{r.note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => setAdding(true)}>
            <UserPlus /> {tr("เพิ่มพนักงาน")}
          </Button>
          {unpaid.length ? (
            <Button size="lg" className="bg-success text-success-foreground hover:bg-success/85" onClick={() => setPaying(unpaid)} data-shot="pay-all">
              <CircleCheck /> {tr("จ่ายเงินทั้งหมด ({0} คน)", unpaid.length)}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-lg" aria-label={tr("เพิ่มเติม")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil /> {tr("แก้ไขชื่องวด / หมายเหตุ")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={hasPaid} onSelect={() => setDeleting(true)}>
                <Trash2 /> {tr("ลบงวดนี้{0}", hasPaid ? tr(" (มีสลิปที่จ่ายแล้ว)") : "")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={trc("plural", "พนักงาน")} value={tr("{0} คน", r.payslipCount)} />
        <Tile label={tr("รายได้รวม")} value={formatBaht(r.totalEarnings)} tone="income" />
        <Tile label={tr("รายการหักรวม")} value={r.totalDeductions ? `−${formatBaht(r.totalDeductions)}` : formatBaht(0)} tone="expense" />
        <Tile label={tr("จ่ายสุทธิรวม")} value={formatBaht(r.totalNet)} />
      </div>

      <Card className="mb-5 gap-0 py-0">
        {r.payslips.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{tr("ยังไม่มีพนักงานในงวดนี้ — กด “เพิ่มพนักงาน”")}</p>
        ) : (
          <Table data-shot="run-payslips">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">{tr("พนักงาน")}</TableHead>
                <TableHead className="text-right">{tr("มาทำงาน")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{tr("รายได้")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{tr("รายการหัก")}</TableHead>
                <TableHead className="text-right">{tr("รับสุทธิ")}</TableHead>
                <TableHead>{tr("สถานะ")}</TableHead>
                <TableHead className="w-12 pr-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.payslips.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setEditing(p.id)}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2.5">
                      <CustomerAvatar name={p.employeeName} colorKey={p.employeeId} size="sm" />
                      <div className="min-w-0">
                        <div className="font-medium">{p.employeeName}</div>
                        {p.position ? <div className="text-xs text-muted-foreground">{p.position}</div> : null}
                        {p.bankAccount ? (
                          <div className="num text-xs text-muted-foreground">
                            {p.bankName ?? ""} {p.bankAccount}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="num text-right">
                    {p.stats.daysWorked.toLocaleString(LOCALE)} <span className="text-xs text-muted-foreground">/ {p.stats.workDays}</span>
                    {p.stats.absentDays || p.stats.lateCount ? (
                      <div className="text-xs text-muted-foreground">
                        {p.stats.absentDays ? tr("ขาด {0} ", p.stats.absentDays) : ""}
                        {p.stats.lateCount ? tr("สาย {0}", p.stats.lateCount) : ""}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="num hidden text-right md:table-cell">{formatBaht(p.earnings)}</TableCell>
                  <TableCell className="num hidden text-right text-expense md:table-cell">{p.deductions ? `−${formatBaht(p.deductions)}` : "—"}</TableCell>
                  <TableCell className={cn("num text-right font-semibold", p.net < 0 && "text-destructive")}>{formatBaht(p.net)}</TableCell>
                  <TableCell>
                    {p.status === "paid" ? (
                      <div title={p.paidAt ? tr("จ่ายเมื่อ {0}", formatDate(p.paidAt)) : undefined}>
                        <Badge className="bg-success/15 text-success">{tr("จ่ายแล้ว")}</Badge>
                        {p.paymentMethod ? <div className="mt-0.5 text-xs text-muted-foreground">{PAY_METHOD_LABELS[p.paymentMethod]}</div> : null}
                      </div>
                    ) : (
                      <Badge variant="outline">{tr("ยังไม่จ่าย")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-3" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={tr("จัดการ {0}", p.employeeName)}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onSelect={() => setEditing(p.id)}>
                          <FileText /> {tr("ดู / แก้ไขสลิป")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPrinting(p)}>
                          <Printer /> {tr("พิมพ์สลิป")}
                        </DropdownMenuItem>
                        {p.status === "unpaid" ? (
                          <>
                            <DropdownMenuItem onSelect={() => setPaying([p])}>
                              <CircleCheck /> {tr("บันทึกจ่ายเงิน")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setRemovingSlip(p)}>
                              <Trash2 /> {tr("นำออกจากงวด")}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {can("audit.view") ? <EntityHistoryCard entityType="payroll" entityId={r.id} description={tr("การสร้าง แก้ไข และลบงวดเงินเดือนนี้")} /> : null}

      <PayslipEditor
        payslipId={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onPay={(p) => setPaying([p])}
        onPrint={(p) => setPrinting(p)}
      />
      <PayDialog payslips={paying} onOpenChange={(o) => !o && setPaying(null)} />
      <PayslipPrintDialog payslip={printing} onOpenChange={(o) => !o && setPrinting(null)} />
      <RenameDialog open={renaming} onOpenChange={setRenaming} run={r} />
      <AddEmployeeDialog open={adding} onOpenChange={setAdding} runId={r.id} periodStart={r.periodStart} periodEnd={r.periodEnd} inRun={new Set(r.payslips.map((p) => p.employeeId))} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={tr("ลบ “{0}”?", r.title)}
        description={tr("สลิปทั้งหมดในงวดนี้จะถูกลบ เงินเบิกล่วงหน้าที่หักไว้จะกลับไปรอหักในงวดถัดไป")}
        confirmText={tr("ลบงวด")}
        destructive
        onConfirm={() => removeRun.mutate()}
      />
      <ConfirmDialog
        open={!!removingSlip}
        onOpenChange={(o) => !o && setRemovingSlip(null)}
        title={tr("นำ “{0}” ออกจากงวดนี้?", removingSlip?.employeeName ?? "")}
        description={tr("สลิปของพนักงานคนนี้ในงวดนี้จะถูกลบ")}
        confirmText={tr("นำออก")}
        destructive
        onConfirm={() => {
          if (removingSlip) removeSlip.mutate(removingSlip.id);
        }}
      />
    </>
  );
}

function RenameDialog({ open, onOpenChange, run }: { open: boolean; onOpenChange: (o: boolean) => void; run: { id: string; title: string; note: string | null } }) {
  const [title, setTitle] = useState(run.title);
  const [note, setNote] = useState(run.note ?? "");
  useEffect(() => {
    if (open) {
      setTitle(run.title);
      setNote(run.note ?? "");
    }
  }, [open, run]);
  const save = useApiMutation(() => api.payroll.updateRun({ id: run.id, title, note }), { successMessage: tr("บันทึกแล้ว"), onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{tr("แก้ไขงวดเงินเดือน")}</DialogTitle>
            <DialogDescription>{tr("ช่วงวันที่ของงวดแก้ไม่ได้ — ถ้าผิด ให้ลบงวดแล้วสร้างใหม่")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rn-title">{tr("ชื่องวด")}</FieldLabel>
            <Input id="rn-title" className="h-10" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <Field>
            <FieldLabel htmlFor="rn-note">{tr("หมายเหตุ")}</FieldLabel>
            <Textarea id="rn-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)}>
              {tr("ยกเลิก")}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending || !title.trim()}>
              {save.isPending ? <Spinner /> : null} {tr("บันทึก")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddEmployeeDialog({
  open,
  onOpenChange,
  runId,
  periodStart,
  periodEnd,
  inRun,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  runId: string;
  periodStart: string;
  periodEnd: string;
  inRun: Set<string>;
}) {
  const q = useQuery({ queryKey: ["payroll", "candidates", periodStart, periodEnd], queryFn: () => api.payroll.candidates({ periodStart, periodEnd }), enabled: open });
  const add = useApiMutation((employeeId: string) => api.payroll.addPayslip({ runId, employeeId }), {
    successMessage: (p) => tr("เพิ่ม {0} ในงวดนี้แล้ว", p.employeeName),
    onSuccess: () => onOpenChange(false),
  });
  const list = (q.data ?? []).filter((c) => !inRun.has(c.employeeId));
  return (
    <Dialog open={open} onOpenChange={(o) => !add.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("เพิ่มพนักงานในงวดนี้")}</DialogTitle>
          <DialogDescription>{tr("ระบบจะคำนวณสลิปของพนักงานที่เลือกให้ทันที")}</DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{tr("พนักงานทุกคนอยู่ในงวดนี้แล้ว")}</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {list.map((c) => (
              <li key={c.employeeId} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted-foreground"> · {c.position ?? c.fullName}</span>
                  {c.overlap ? <span className="block text-xs text-destructive">{tr("มีสลิปใน “{0}” แล้ว", c.overlap.title)}</span> : null}
                </span>
                <Button size="sm" variant="outline" disabled={!!c.overlap || add.isPending} onClick={() => add.mutate(c.employeeId)}>
                  {tr("เพิ่ม")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
