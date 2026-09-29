"use client";
import { CalendarDays, Clock, Plus, X } from "lucide-react";
import { useState } from "react";
import type { AppSettings, LateDeduction } from "@shared/contract";
import { hhmmMinutes, isDateStr, isHhmm } from "@shared/dates";
import { socialSecurityOf } from "@shared/payroll";
import { MoneyInput } from "@/components/money-input";
import { QtyInput } from "@/components/qty-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatBaht, formatDateStr } from "@/lib/format";
import { tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FormField, SectionCard, StepperInput, SwitchRow } from "./section-card";
import { useSectionForm, type FieldErrors } from "./use-section-form";

type Payroll = AppSettings["payroll"];

const WEEKDAYS = [tr("อา."), tr("จ."), tr("อ."), tr("พ."), tr("พฤ."), tr("ศ."), tr("ส.")];

const LATE_MODES: { value: LateDeduction; title: string; hint: string }[] = [
  { value: "none", title: tr("ไม่หักเงิน"), hint: tr("นับจำนวนครั้ง/นาทีที่สายไว้ดูเท่านั้น") },
  { value: "per_minute", title: tr("หักตามนาทีที่สาย"), hint: tr("คิดจากค่าแรงต่อชั่วโมง ÷ 60 × นาทีที่สาย") },
  { value: "per_time", title: tr("หักครั้งละเท่ากัน"), hint: tr("สายวันไหน หักตามจำนวนเงินที่ตั้งไว้") },
];

function validate(v: Payroll): FieldErrors<Payroll> {
  const e: FieldErrors<Payroll> = {};
  if (!isHhmm(v.workStart)) e.workStart = tr("เวลาไม่ถูกต้อง");
  if (!isHhmm(v.workEnd)) e.workEnd = tr("เวลาไม่ถูกต้อง");
  else if (isHhmm(v.workStart) && hhmmMinutes(v.workEnd) <= hhmmMinutes(v.workStart)) e.workEnd = tr("เวลาเลิกงานต้องหลังเวลาเข้างาน");
  if (!v.workDays.length) e.workDays = tr("เลือกวันทำงานอย่างน้อย 1 วัน");
  if (!(v.hoursPerDay >= 1 && v.hoursPerDay <= 24)) e.hoursPerDay = tr("1–24 ชั่วโมง");
  if (!(v.otMultiplier >= 1 && v.otMultiplier <= 5)) e.otMultiplier = tr("1–5 เท่า");
  if (!(v.socialSecurityRate >= 0 && v.socialSecurityRate <= 20)) e.socialSecurityRate = "0–20%";
  if (v.socialSecurityMaxBase < v.socialSecurityMinBase) e.socialSecurityMaxBase = tr("ต้องไม่น้อยกว่าฐานต่ำสุด");
  return e;
}

/** Work schedule and pay rules used by the time clock and payslips. */
export function PayrollSection({ saved }: { saved: Payroll }) {
  const f = useSectionForm("payroll", saved, { validate, successMessage: tr("บันทึกการตั้งค่าเวลางานและเงินเดือนแล้ว") });
  const v = f.value;
  const [holiday, setHoliday] = useState("");

  const toggleDay = (d: number) => f.set("workDays", v.workDays.includes(d) ? v.workDays.filter((x) => x !== d) : [...v.workDays, d].sort((a, b) => a - b));
  const addHoliday = () => {
    if (!isDateStr(holiday) || v.holidays.includes(holiday)) return;
    f.set("holidays", [...v.holidays, holiday].sort());
    setHoliday("");
  };

  return (
    <SectionCard icon={Clock} title={tr("เวลางานและการคำนวณเงินเดือน")} description={tr("ใช้ตัดสินมาสาย ขาดงาน OT และคำนวณสลิปเงินเดือน — แก้แล้วมีผลกับการคำนวณครั้งถัดไป")} form={f} shot="payroll-settings">
      <div className="space-y-7">
        <div className="grid gap-5 @2xl/settings:grid-cols-3">
          <FormField label={tr("เวลาเข้างาน")} htmlFor="ps-start" error={f.errorOf("workStart")}>
            <Input id="ps-start" type="time" className="h-10 w-36 text-base" value={v.workStart} onChange={(e) => f.set("workStart", e.target.value)} />
          </FormField>
          <FormField label={tr("เวลาเลิกงาน")} htmlFor="ps-end" error={f.errorOf("workEnd")}>
            <Input id="ps-end" type="time" className="h-10 w-36 text-base" value={v.workEnd} onChange={(e) => f.set("workEnd", e.target.value)} />
          </FormField>
          <FormField label={tr("มาสายได้ไม่เกิน")} htmlFor="ps-grace" hint={tr("เกินจากนี้นับว่าสาย (นับนาทีตั้งแต่เวลาเข้างาน)")}>
            <StepperInput id="ps-grace" value={v.lateGraceMinutes} onChange={(n) => f.set("lateGraceMinutes", n)} min={0} max={240} suffix={tr("นาที")} />
          </FormField>
        </div>

        <FormField label={tr("วันทำงาน")} error={f.errorOf("workDays")} hint={tr("วันที่ไม่ได้เลือกเป็นวันหยุดประจำสัปดาห์ (ไม่นับขาดงาน)")}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={tr("วันทำงาน")}>
            {WEEKDAYS.map((label, d) => {
              const on = v.workDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "h-10 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </FormField>

        <FormField label={tr("วันหยุดร้าน (นักขัตฤกษ์ / หยุดพิเศษ)")} hint={tr("วันหยุดไม่นับเป็นวันขาดงาน")}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" className="h-10 w-44" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label={tr("วันหยุด")} />
              <Button type="button" variant="outline" onClick={addHoliday} disabled={!isDateStr(holiday)}>
                <Plus /> {tr("เพิ่มวันหยุด")}
              </Button>
            </div>
            {v.holidays.length ? (
              <div className="flex flex-wrap gap-1.5">
                {v.holidays.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-sm">
                    <CalendarDays className="size-3.5 text-muted-foreground" />
                    {formatDateStr(d)}
                    <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={tr("ลบวันหยุด {0}", formatDateStr(d))} onClick={() => f.set("holidays", v.holidays.filter((x) => x !== d))}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{tr("ยังไม่มีวันหยุดพิเศษ")}</p>
            )}
          </div>
        </FormField>

        <div className="grid gap-5 @2xl/settings:grid-cols-2">
          <FormField label={tr("ชั่วโมงทำงานต่อวัน")} htmlFor="ps-hours" error={f.errorOf("hoursPerDay")} hint={tr("ใช้คิดค่าแรงต่อชั่วโมง (OT / หักสาย)")}>
            <div className="flex items-center gap-2">
              <QtyInput id="ps-hours" className="h-10 w-24 text-base" value={v.hoursPerDay} onChange={(n) => f.set("hoursPerDay", n)} />
              <span className="text-sm text-muted-foreground">{trc("unit", "ชั่วโมง")}</span>
            </div>
          </FormField>
          <FormField label={tr("วันต่อเดือน (พนักงานรายเดือน)")} htmlFor="ps-days" hint={tr("ค่าแรงต่อวัน = เงินเดือน ÷ {0} (ใช้หักขาดงาน / ลาไม่รับค่าจ้าง)", v.daysPerMonth)}>
            <StepperInput id="ps-days" value={v.daysPerMonth} onChange={(n) => f.set("daysPerMonth", n)} min={20} max={31} suffix={tr("วัน")} />
          </FormField>
        </div>

        <div>
          <div className="text-sm font-medium">{tr("การหักเงินเมื่อมาสาย")}</div>
          <RadioGroup value={v.lateDeduction} onValueChange={(m) => f.set("lateDeduction", m as LateDeduction)} className="mt-2 grid gap-2 @2xl/settings:grid-cols-3" aria-label={tr("การหักเงินเมื่อมาสาย")}>
            {LATE_MODES.map((m) => (
              <label
                key={m.value}
                htmlFor={`late-${m.value}`}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted/40",
                  v.lateDeduction === m.value && "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                )}
              >
                <span className="flex items-center gap-2">
                  <RadioGroupItem id={`late-${m.value}`} value={m.value} />
                  <span className="text-sm font-medium">{m.title}</span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{m.hint}</span>
              </label>
            ))}
          </RadioGroup>
          {v.lateDeduction === "per_time" ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm">{tr("หักครั้งละ")}</span>
              <div className="w-36">
                <MoneyInput className="h-10" value={v.lateDeductionAmount} onChange={(n) => f.set("lateDeductionAmount", n ?? 0)} aria-label={tr("หักครั้งละ")} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <SwitchRow
            title={tr("หักเงินวันขาดงาน (พนักงานรายเดือน)")}
            description={tr("วันทำงานที่ไม่มีการลงเวลาและไม่มีวันลา จะถูกหักตามค่าแรงต่อวัน (พนักงานรายวันได้ค่าแรงเฉพาะวันที่มาทำงานอยู่แล้ว)")}
            checked={v.deductAbsence}
            onCheckedChange={(on) => f.set("deductAbsence", on)}
          />
          <SwitchRow
            title={tr("คิดค่าล่วงเวลา (OT) อัตโนมัติ")}
            description={tr("เวลาที่ทำงานเกินเวลาเลิกงานในวันทำงาน จะคิดเป็น OT ในสลิปเงินเดือน (ถ้าปิดไว้ ยังเพิ่ม OT เองในสลิปได้)")}
            checked={v.otEnabled}
            onCheckedChange={(on) => f.set("otEnabled", on)}
          >
            {v.otEnabled ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                <label className="flex items-center gap-2 text-sm">
                  {tr("อัตรา")}
                  <QtyInput className="h-9 w-20" value={v.otMultiplier} onChange={(n) => f.set("otMultiplier", n)} aria-label={tr("อัตรา OT")} />
                  {tr("เท่าของค่าแรงต่อชั่วโมง")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {tr("นับเมื่อเกินอย่างน้อย")}
                  <StepperInput value={v.otMinMinutes} onChange={(n) => f.set("otMinMinutes", n)} min={0} max={240} suffix={tr("นาที")} />
                </label>
              </div>
            ) : null}
          </SwitchRow>
        </div>

        <div>
          <div className="text-sm font-medium">{tr("ประกันสังคม (ส่วนของลูกจ้าง)")}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{tr("หักเฉพาะพนักงานที่เปิด “หักประกันสังคม” ไว้ในข้อมูลพนักงาน · กรุณาตรวจสอบอัตราล่าสุดกับสำนักงานประกันสังคม")}</p>
          <div className="mt-3 grid gap-4 @2xl/settings:grid-cols-3">
            <FormField label={tr("อัตราเงินสมทบ")} htmlFor="ps-ssf" error={f.errorOf("socialSecurityRate")}>
              <div className="flex items-center gap-2">
                <QtyInput id="ps-ssf" className="h-10 w-20 text-base" value={v.socialSecurityRate} onChange={(n) => f.set("socialSecurityRate", n)} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </FormField>
            <FormField label={tr("ฐานค่าจ้างต่ำสุด")} htmlFor="ps-ssf-min">
              <MoneyInput id="ps-ssf-min" className="h-10" value={v.socialSecurityMinBase} onChange={(n) => f.set("socialSecurityMinBase", n ?? 0)} />
            </FormField>
            <FormField label={tr("ฐานค่าจ้างสูงสุด")} htmlFor="ps-ssf-max" error={f.errorOf("socialSecurityMaxBase")}>
              <MoneyInput id="ps-ssf-max" className="h-10" value={v.socialSecurityMaxBase} onChange={(n) => f.set("socialSecurityMaxBase", n ?? 0)} />
            </FormField>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {tr("ตัวอย่าง: เงินเดือน ฿15,000 หัก {0} · สูงสุดเดือนละ {1}", formatBaht(socialSecurityOf(1_500_000, v)), formatBaht(socialSecurityOf(v.socialSecurityMaxBase, v)))}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
