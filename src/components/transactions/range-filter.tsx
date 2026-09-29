"use client";
/** Date presets (วันนี้ / เมื่อวาน / 7 วัน / เดือนนี้ / ทั้งหมด) + a calendar popover for a custom range. */
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dayRange, formatDate, lastDaysRange, monthRange, startOfDay, type Range } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CALENDAR_LOCALE } from "@/lib/calendar-locale";

export type RangePreset = "today" | "yesterday" | "7d" | "month" | "all" | "custom";
type FixedPreset = Exclude<RangePreset, "custom">;

export const RANGE_PRESETS: { key: FixedPreset; label: string }[] = [
  { key: "today", label: tr("วันนี้") },
  { key: "yesterday", label: tr("เมื่อวาน") },
  { key: "7d", label: tr("7 วัน") },
  { key: "month", label: tr("เดือนนี้") },
  { key: "all", label: tr("ทั้งหมด") },
];

export const isRangePreset = (v: string | null): v is FixedPreset => RANGE_PRESETS.some((p) => p.key === v);

/** [from, to) of a preset in local time; null = no date filter. */
export function presetRange(key: FixedPreset, now = Date.now()): Range | null {
  switch (key) {
    case "today":
      return dayRange(now);
    case "yesterday": {
      const d = startOfDay(now);
      d.setDate(d.getDate() - 1);
      return dayRange(d);
    }
    case "7d":
      return lastDaysRange(7, now);
    case "month":
      return monthRange(now);
    case "all":
      return null;
  }
}

/** The preset a range corresponds to (e.g. the dashboard links "today" as from/to). */
export function matchPreset(r: Range, now = Date.now()): FixedPreset | null {
  for (const p of RANGE_PRESETS) {
    const pr = presetRange(p.key, now);
    if (pr && pr.from === r.from && pr.to === r.to) return p.key;
  }
  return null;
}

const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });

/** "25 ก.ย. 2569" / "1 – 25 ก.ย. 2569" / "28 ส.ค. – 3 ก.ย. 2569" / "28 ธ.ค. 2568 – 3 ม.ค. 2569" */
export function formatRangeLabel(r: Range): string {
  const a = new Date(r.from);
  const b = new Date(r.to - 1);
  if (startOfDay(a).getTime() === startOfDay(b).getTime()) return formatDate(a.getTime());
  if (a.getFullYear() !== b.getFullYear()) return `${formatDate(a.getTime())} – ${formatDate(b.getTime())}`;
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${formatDate(b.getTime())}`;
  return `${dayMonth.format(a)} – ${formatDate(b.getTime())}`;
}

const captionFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });

export function RangeFilter({
  preset,
  range,
  onPreset,
  onCustom,
  className,
}: {
  preset: RangePreset;
  range: Range | null;
  onPreset: (key: FixedPreset) => void;
  onCustom: (range: Range) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayPickerRange | undefined>();

  const openCustom = () => {
    const r = range ?? presetRange("month")!;
    setDraft({ from: new Date(r.from), to: new Date(r.to - 1) });
    setOpen(true);
  };
  const apply = () => {
    if (!draft?.from) return;
    const last = draft.to ?? draft.from;
    const from = startOfDay(draft.from).getTime();
    const to = dayRange(last).to;
    onCustom({ from, to });
    setOpen(false);
  };
  const draftLabel = draft?.from ? formatRangeLabel({ from: startOfDay(draft.from).getTime(), to: dayRange(draft.to ?? draft.from).to }) : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ToggleGroup
        type="single"
        spacing={1}
        value={preset === "custom" ? "" : preset}
        onValueChange={(v) => {
          if (isRangePreset(v)) onPreset(v);
        }}
        className="rounded-xl bg-muted p-1"
        aria-label={tr("ช่วงเวลา")}
      >
        {RANGE_PRESETS.map((p) => (
          <ToggleGroupItem
            key={p.key}
            value={p.key}
            data-shot={`range-${p.key}`}
            className="h-8 rounded-lg px-3 text-muted-foreground hover:bg-background/60 data-[state=on]:bg-background data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/50"
          >
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={open} onOpenChange={(o) => (o ? openCustom() : setOpen(false))}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("h-10 gap-2 rounded-xl px-3", preset === "custom" && "border-primary/50 bg-primary/8 text-primary hover:bg-primary/12 hover:text-primary")}
            data-shot="range-custom"
          >
            <CalendarDays />
            <span className="num">{preset === "custom" && range ? formatRangeLabel(range) : tr("กำหนดเอง")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-3">
          <Calendar
            mode="range"
            numberOfMonths={2}
            locale={CALENDAR_LOCALE}
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.from ? new Date(draft.from.getFullYear(), draft.from.getMonth() - (draft.to && draft.to.getMonth() !== draft.from.getMonth() ? 0 : 1), 1) : undefined}
            formatters={{ formatCaption: (d: Date) => captionFmt.format(d) }}
            className="p-0 [--cell-size:--spacing(8.5)]"
          />
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
            <span className="num text-sm text-muted-foreground">{draftLabel ?? tr("เลือกวันเริ่มต้นและวันสิ้นสุด")}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="lg" onClick={() => setOpen(false)}>
                {tr("ยกเลิก")}
              </Button>
              <Button size="lg" onClick={apply} disabled={!draft?.from} data-shot="range-apply">
                {tr("ตกลง")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
