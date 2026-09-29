"use client";
/** Bill date + time with Thai (Buddhist-era) display. `null` means "now". */
import { CalendarDays, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, formatTime, startOfDay } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useNow } from "./hooks";
import { CALENDAR_LOCALE } from "@/lib/calendar-locale";

const captionFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
export const thaiCalendarProps = {
  locale: CALENDAR_LOCALE,
  formatters: { formatCaption: (d: Date) => captionFmt.format(d) },
} as const;

function sameDay(a: number, b: number) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function dayLabel(ms: number, now = Date.now()): string {
  if (sameDay(ms, now)) return tr("วันนี้ · {0}", formatDate(ms));
  if (sameDay(ms, now - 86_400_000)) return tr("เมื่อวาน · {0}", formatDate(ms));
  return formatDate(ms);
}

function parseTime(text: string): [number, number] | null {
  const m = text.trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? [h, min] : null;
}

export function DateTimeField({
  value,
  onChange,
  allowNow = true,
  className,
}: {
  value: number | null;
  onChange: (ms: number | null) => void;
  /** Offer "ใช้เวลาปัจจุบัน" to go back to "now". */
  allowNow?: boolean;
  className?: string;
}) {
  const now = useNow();
  const ms = value ?? now;
  const [open, setOpen] = useState(false);
  const [timeText, setTimeText] = useState(formatTime(ms));
  const [editingTime, setEditingTime] = useState(false);

  useEffect(() => {
    if (!editingTime) setTimeText(formatTime(ms));
  }, [ms, editingTime]);

  const setDay = (d: Date | undefined) => {
    if (!d) return;
    const cur = new Date(ms);
    const next = new Date(d);
    next.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
    onChange(next.getTime());
    setOpen(false);
  };

  const commitTime = () => {
    setEditingTime(false);
    const t = parseTime(timeText);
    if (!t) return setTimeText(formatTime(ms));
    const d = new Date(ms);
    d.setHours(t[0], t[1], 0, 0);
    if (d.getTime() !== ms || value === null) onChange(d.getTime());
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="h-9 justify-start gap-2 px-3 font-normal" data-shot="bill-date">
            <CalendarDays className="text-muted-foreground" />
            <span className="num">{dayLabel(ms, now)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-1">
          <Calendar mode="single" selected={new Date(ms)} onSelect={setDay} defaultMonth={new Date(ms)} disabled={{ after: new Date(now) }} {...thaiCalendarProps} />
        </PopoverContent>
      </Popover>
      <div className="relative">
        <Clock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={timeText}
          onChange={(e) => {
            setEditingTime(true);
            setTimeText(e.target.value);
          }}
          onBlur={commitTime}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          inputMode="numeric"
          className="num h-9 w-[84px] pl-8"
          aria-label={tr("เวลา")}
        />
      </div>
      {allowNow && value !== null ? (
        <Button type="button" variant="link" size="sm" className="h-auto px-1 text-xs text-muted-foreground" onClick={() => onChange(null)}>
          {tr("ใช้เวลาปัจจุบัน")}
        </Button>
      ) : null}
    </div>
  );
}
