"use client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Quantity input (up to 2 decimals). */
export function QtyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (qty: number) => void;
}) {
  return (
    <Input
      {...props}
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      className={cn("num text-right", className)}
      value={Number.isFinite(value) ? value : ""}
      onFocus={(e) => {
        e.target.select();
        props.onFocus?.(e);
      }}
      onChange={(e) => {
        const n = e.target.value === "" ? 0 : Math.round(Number(e.target.value) * 100) / 100;
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}
