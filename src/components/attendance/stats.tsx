"use client";
import type { AttendanceStats } from "@shared/contract";
import { formatMinutes } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const days = (n: number) => tr("{0} วัน", n.toLocaleString(LOCALE, { maximumFractionDigits: 1 }));
/** Compact "212 ชม. 1 น." for the tiles. */
const hours = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return tr("{0} นาที", m);
  return m ? tr("{0} ชม. {1} น.", h, m) : tr("{0} ชม.", h);
};

/** Headline attendance figures of a period as small tiles. */
export function StatsTiles({ stats, className }: { stats: AttendanceStats; className?: string }) {
  const leave = stats.paidLeaveDays + stats.unpaidLeaveDays;
  const tiles: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }[] = [
    { label: tr("มาทำงาน"), value: days(stats.daysWorked), sub: tr("จากวันทำงาน {0} วัน", stats.workDays.toLocaleString(LOCALE, { maximumFractionDigits: 1 })) },
    { label: tr("ชั่วโมงรวม"), value: hours(stats.minutesWorked) },
    { label: tr("มาสาย"), value: tr("{0} ครั้ง", stats.lateCount), sub: stats.lateMinutes ? tr("รวม {0}", formatMinutes(stats.lateMinutes)) : undefined, tone: stats.lateCount ? "warn" : undefined },
    { label: tr("ขาดงาน"), value: days(stats.absentDays), tone: stats.absentDays ? "bad" : undefined },
    { label: tr("ลา"), value: days(leave), sub: stats.unpaidLeaveDays ? tr("ไม่รับค่าจ้าง {0}", days(stats.unpaidLeaveDays)) : undefined },
    { label: tr("ล่วงเวลา (OT)"), value: stats.otMinutes ? hours(stats.otMinutes) : "—" },
  ];
  // Six in a row only when there is room for them (a dialog gets two rows of three).
  return (
    <div className={cn("@container", className)}>
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3 @4xl:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(
              "rounded-lg border bg-card px-3 py-2",
              t.tone === "warn" && "border-warning/50 bg-warning/10",
              t.tone === "bad" && "border-destructive/30 bg-destructive/5",
            )}
          >
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="num text-lg font-semibold">{t.value}</div>
            {t.sub ? <div className="text-xs text-muted-foreground">{t.sub}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
