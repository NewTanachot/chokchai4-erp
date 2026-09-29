"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { endOfMonth, parseDateStr, toDateStr } from "@shared/dates";
import { Button } from "@/components/ui/button";
import { LOCALE, tr } from "@/lib/i18n";

const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });

/** First day "YYYY-MM-01" of the month containing `d` (default today). */
export const monthOf = (d: string | number = Date.now()): string => `${(typeof d === "number" ? toDateStr(d) : d).slice(0, 7)}-01`;

export function monthBounds(month: string): { from: string; to: string } {
  return { from: month, to: endOfMonth(month) };
}

function shift(month: string, delta: number): string {
  const d = parseDateStr(month);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

/** ‹ กันยายน 2569 › — a month (its first day, "YYYY-MM-01"). */
export function MonthPicker({ value, onChange, className }: { value: string; onChange: (month: string) => void; className?: string }) {
  const isCurrent = value === monthOf();
  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon" aria-label={tr("เดือนก่อน")} onClick={() => onChange(shift(value, -1))}>
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium">{monthFmt.format(parseDateStr(value))}</span>
        <Button type="button" variant="outline" size="icon" aria-label={tr("เดือนถัดไป")} onClick={() => onChange(shift(value, 1))} disabled={isCurrent}>
          <ChevronRight />
        </Button>
        {!isCurrent ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(monthOf())}>
            {tr("เดือนนี้")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
