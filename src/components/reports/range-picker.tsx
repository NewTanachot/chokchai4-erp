"use client";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate, toDateInput, type Range } from "@/lib/format";
import { formatDayShort, formatMonthLong } from "./format";
import { PRESETS, type PresetKey } from "./ranges";
import { CALENDAR_LOCALE } from "@/lib/calendar-locale";
import { tr } from "@/lib/i18n";

/** "25 ก.ย. 2569" / "1 – 25 ก.ย. 2569" / "28 ส.ค. – 3 ก.ย. 2569" / "28 ธ.ค. 2568 – 3 ม.ค. 2569" */
export function formatRangeLabel(r: Range): string {
  const a = new Date(r.from);
  const b = new Date(r.to - 1);
  if (toDateInput(a.getTime()) === toDateInput(b.getTime())) return formatDate(a.getTime());
  if (a.getFullYear() !== b.getFullYear()) return `${formatDate(a.getTime())} – ${formatDate(b.getTime())}`;
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${formatDate(b.getTime())}`;
  return `${formatDayShort(a.getTime())} – ${formatDate(b.getTime())}`;
}

/** Preset segmented control + a calendar popover for a custom range. */
export function RangePicker({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: PresetKey;
  range: Range;
  onPreset: (key: Exclude<PresetKey, "custom">) => void;
  /** Inclusive first / last day ("YYYY-MM-DD"). */
  onCustom: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayPickerRange | undefined>();

  const openCustom = () => {
    setDraft({ from: new Date(range.from), to: new Date(range.to - 1) });
    setOpen(true);
  };
  const apply = () => {
    if (!draft?.from) return;
    const to = draft.to ?? draft.from;
    onCustom(toDateInput(draft.from.getTime()), toDateInput(to.getTime()));
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        spacing={1}
        value={preset === "custom" ? "" : preset}
        onValueChange={(v) => {
          if (v && v !== "custom") onPreset(v as Exclude<PresetKey, "custom">);
        }}
        className="flex-wrap rounded-xl bg-muted p-1"
        aria-label={tr("ช่วงเวลา")}
      >
        {PRESETS.filter((p) => p.key !== "custom").map((p) => (
          <ToggleGroupItem
            key={p.key}
            value={p.key}
            data-shot={`range-${p.key}`}
            className="h-9 rounded-lg px-3.5 text-muted-foreground hover:bg-background/60 data-[state=on]:bg-background data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/40"
          >
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={open} onOpenChange={(o) => (o ? openCustom() : setOpen(false))}>
        <PopoverTrigger asChild>
          <Button variant={preset === "custom" ? "default" : "outline"} size="lg" className="h-11 px-3.5" data-shot="range-custom">
            <CalendarDays />
            {preset === "custom" ? formatRangeLabel(range) : tr("กำหนดเอง")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <Calendar
            mode="range"
            numberOfMonths={2}
            locale={CALENDAR_LOCALE}
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.from ? new Date(draft.from.getFullYear(), draft.from.getMonth() - (draft.to && draft.to.getMonth() !== draft.from.getMonth() ? 0 : 1), 1) : undefined}
            formatters={{ formatCaption: (d: Date) => formatMonthLong(d.getTime()) }}
            className="p-0 [--cell-size:--spacing(8.5)]"
          />
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span className="text-sm text-muted-foreground">
              {draft?.from ? formatRangeLabel({ from: draft.from.getTime(), to: (draft.to ?? draft.from).getTime() + 1 }) : tr("เลือกวันเริ่มต้นและวันสิ้นสุด")}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {tr("ยกเลิก")}
              </Button>
              <Button onClick={apply} disabled={!draft?.from} data-shot="range-apply">
                {tr("ตกลง")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
