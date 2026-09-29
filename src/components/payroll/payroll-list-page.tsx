"use client";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarRange, CircleCheck, Plus, Settings2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatCard } from "@/components/catalog/stat-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { formatBaht, formatDateStr } from "@/lib/format";
import { LOCALE, tr, trc } from "@/lib/i18n";
import { CreateRunDialog } from "./create-run-dialog";

export function PayrollListPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const runs = useQuery({ queryKey: ["payroll", "runs"], queryFn: () => api.payroll.listRuns({ limit: 200 }) });
  const advances = useQuery({ queryKey: ["payroll", "advances", { status: "outstanding" }], queryFn: () => api.payroll.listAdvances({ status: "outstanding", limit: 500 }) });
  const items = runs.data?.items ?? [];
  const unpaid = items.reduce((s, r) => s + (r.payslipCount - r.paidCount), 0);
  const outstanding = (advances.data?.items ?? []).reduce((s, a) => s + a.amount, 0);
  const latest = items[0];

  return (
    <>
      <PageHeader
        title={trc("nav", "เงินเดือน")}
        description={tr("สร้างงวดเงินเดือน คำนวณจากเวลาทำงาน ตรวจสลิป แล้วบันทึกการจ่ายเงิน")}
        actions={
          <>
            <Button asChild variant="ghost" size="lg">
              <Link href="/settings/?section=payroll">
                <Settings2 /> {tr("ตั้งค่าการคำนวณ")}
              </Link>
            </Button>
            <Button size="lg" onClick={() => setCreateOpen(true)} data-shot="new-run">
              <Plus /> {tr("สร้างงวดเงินเดือน")}
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Wallet}
          label={tr("งวดล่าสุด")}
          loading={runs.isPending}
          value={latest ? formatBaht(latest.totalNet) : "—"}
          sub={latest ? tr("{0} · {1} คน", latest.title, latest.payslipCount) : tr("ยังไม่มีงวดเงินเดือน")}
        />
        <StatCard
          icon={CircleCheck}
          tone={unpaid ? "warning" : "success"}
          label={tr("สลิปที่ยังไม่จ่าย")}
          loading={runs.isPending}
          value={
            <>
              {unpaid.toLocaleString(LOCALE)} <span className="text-base font-normal text-muted-foreground">{tr("สลิป")}</span>
            </>
          }
          sub={unpaid ? tr("เปิดงวดเพื่อบันทึกการจ่ายเงิน") : tr("จ่ายครบทุกสลิปแล้ว")}
        />
        <StatCard
          icon={Banknote}
          label={tr("เงินเบิกล่วงหน้า รอหัก")}
          loading={advances.isPending}
          value={formatBaht(outstanding)}
          sub={tr("{0} รายการ · จะหักในงวดถัดไปอัตโนมัติ", advances.data?.total ?? 0)}
        />
      </div>

      <Card className="gap-0 py-0">
        {runs.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : runs.isError ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(runs.error)}</p>
        ) : items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
                <CalendarRange />
              </EmptyMedia>
              <EmptyTitle className="text-base">{tr("ยังไม่มีงวดเงินเดือน")}</EmptyTitle>
              <EmptyDescription>{tr("สร้างงวดแรก เช่น “เดือนที่แล้ว” ระบบจะคำนวณเงินเดือน ค่าแรงรายวัน หักสาย/ขาด/เบิกล่วงหน้าให้อัตโนมัติ")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="lg" onClick={() => setCreateOpen(true)}>
                <Plus /> {tr("สร้างงวดเงินเดือน")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">{tr("งวด")}</TableHead>
                <TableHead className="text-right">{tr("พนักงาน")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{tr("รายได้รวม")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{tr("รายการหัก")}</TableHead>
                <TableHead className="text-right">{tr("จ่ายสุทธิ")}</TableHead>
                <TableHead className="pr-4">{tr("สถานะ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => {
                const done = r.payslipCount > 0 && r.paidCount === r.payslipCount;
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/payroll/view/?id=${r.id}`)}>
                    <TableCell className="pl-4">
                      <Link href={`/payroll/view/?id=${r.id}`} className="font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatDateStr(r.periodStart)} – {formatDateStr(r.periodEnd)}
                      </div>
                      {r.createdByName ? <div className="text-xs text-muted-foreground">{tr("สร้างโดย {0}", r.createdByName)}</div> : null}
                    </TableCell>
                    <TableCell className="num text-right">{tr("{0} คน", r.payslipCount)}</TableCell>
                    <TableCell className="num hidden text-right md:table-cell">{formatBaht(r.totalEarnings)}</TableCell>
                    <TableCell className="num hidden text-right text-expense md:table-cell">{r.totalDeductions ? `−${formatBaht(r.totalDeductions)}` : "—"}</TableCell>
                    <TableCell className="num text-right font-semibold">{formatBaht(r.totalNet)}</TableCell>
                    <TableCell className="pr-4">
                      {done ? (
                        <Badge className="bg-success/15 text-success">{tr("จ่ายครบแล้ว")}</Badge>
                      ) : r.paidCount ? (
                        <Badge variant="outline" className="border-warning/50 bg-warning/10">
                          {tr("จ่ายแล้ว {0}/{1}", r.paidCount, r.payslipCount)}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{tr("ยังไม่จ่าย")}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <CreateRunDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
