"use client";
import { Minus, Plus, RotateCcw, Save } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Card with a title row and (optionally) a footer holding the section's own "บันทึก" button. */
export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  form,
  className,
  contentClassName,
  shot,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Extra element in the header's right corner. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** When given, the card is a <form> with save / discard buttons in the footer. */
  form?: { dirty: boolean; saving: boolean; submit: (e?: React.FormEvent) => void; reset: () => void };
  className?: string;
  contentClassName?: string;
  shot?: string;
}) {
  const body = (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="border-b py-4">
        <div className={cn("flex gap-3", description ? "items-start" : "items-center")}>
          {Icon ? (
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15">
              <Icon className="size-[18px]" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            {description ? <CardDescription className="mt-0.5">{description}</CardDescription> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn("py-5", contentClassName)}>{children}</CardContent>
      {form ? (
        <CardFooter className="flex-wrap justify-end gap-2 px-4 py-3">
          {form.dirty ? (
            <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-2 rounded-full bg-warning" aria-hidden />
              {tr("มีการแก้ไขที่ยังไม่บันทึก")}
            </span>
          ) : (
            <span className="mr-auto text-sm text-muted-foreground">{tr("บันทึกแล้ว — ยังไม่มีการแก้ไข")}</span>
          )}
          {form.dirty ? (
            <Button type="button" variant="ghost" size="lg" onClick={form.reset} disabled={form.saving}>
              <RotateCcw /> {tr("ยกเลิกการแก้ไข")}
            </Button>
          ) : null}
          <Button type="submit" size="lg" className="min-w-28" disabled={!form.dirty || form.saving} data-shot={shot ? `${shot}-save` : undefined}>
            {form.saving ? <Spinner /> : <Save />} {tr("บันทึก")}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
  if (!form) return body;
  return (
    <form onSubmit={form.submit} noValidate>
      {body}
    </form>
  );
}

/** Label + description on the left, switch on the right; the whole row toggles. */
export function SwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
  shot,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  /** Extra content under the description (e.g. an example). */
  children?: React.ReactNode;
  shot?: string;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-lg border p-4 transition-colors",
        checked ? "border-primary/25 bg-primary/[0.03] dark:bg-primary/[0.06]" : "bg-transparent",
        disabled && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={id} className={cn("text-sm font-medium leading-snug", !disabled && "cursor-pointer")}>
          {title}
        </Label>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5 scale-110" data-shot={shot} />
    </div>
  );
}

/** Form field: label, control, hint / error. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-invalid={error ? true : undefined}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Integer stepper: [−] [ n ] [+]. */
export function StepperInput({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
  disabled,
  invalid,
}: {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="rounded-r-none"
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= min}
          aria-label={tr("ลด")}
        >
          <Minus />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          className="num h-9 w-16 rounded-none border-x-0 text-center text-base"
          value={Number.isFinite(value) ? String(value) : ""}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(digits === "" ? NaN : Number(digits));
          }}
          onBlur={() => onChange(clamp(Number.isFinite(value) ? value : min))}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="rounded-l-none"
          onClick={() => onChange(clamp((Number.isFinite(value) ? value : min - 1) + 1))}
          disabled={disabled || value >= max}
          aria-label={tr("เพิ่ม")}
        >
          <Plus />
        </Button>
      </div>
      {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}
