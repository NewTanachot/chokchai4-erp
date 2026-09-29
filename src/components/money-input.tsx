"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { LOCALE, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const fmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toText(satang: number | null | undefined): string {
  return satang == null ? "" : fmt.format(satang / 100);
}

function parseSatang(text: string): number | null {
  const cleaned = text.replace(/[,\s฿]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Baht amount input. `value`/`onChange` are integer SATANG. Shows "1,234.50" when not focused,
 * raw number while typing. Empty input reports 0 (or null when `allowEmpty`).
 */
export function MoneyInput({
  value,
  onChange,
  allowEmpty = false,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  onChange: (satang: number | null) => void;
  allowEmpty?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => toText(value));
  const last = useRef(value);

  useEffect(() => {
    if (!focused && value !== last.current) setText(toText(value));
    last.current = value;
  }, [value, focused]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">฿</span>
      <Input
        {...props}
        inputMode="decimal"
        className={cn("num pl-6 text-right", className)}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          setText(value == null ? "" : String(value / 100));
          requestAnimationFrame(() => e.target.select());
          props.onFocus?.(e);
        }}
        onChange={(e) => {
          const t = e.target.value;
          if (!/^[\d,.\s]*$/.test(t)) return;
          setText(t);
          const s = parseSatang(t);
          last.current = s ?? (allowEmpty ? null : 0);
          onChange(last.current);
        }}
        onBlur={(e) => {
          setFocused(false);
          setText(toText(value));
          props.onBlur?.(e);
        }}
      />
    </div>
  );
}
