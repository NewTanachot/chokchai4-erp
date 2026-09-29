import { Car } from "lucide-react";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Vehicle plate as a compact chip. */
export function PlateChip({ plate, className }: { plate: string; className?: string }) {
  return (
    <span
      title={plate}
      className={cn(
        "inline-flex h-6 max-w-[13rem] min-w-0 items-center gap-1 rounded-md border bg-muted/50 px-1.5 text-xs text-foreground/85",
        className,
      )}
    >
      <Car className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{plate}</span>
    </span>
  );
}

/** First `max` plates + "+N". */
export function PlateChips({ plates, max = 2, className }: { plates: string[]; max?: number; className?: string }) {
  if (plates.length === 0) return null;
  const more = plates.length - max;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {plates.slice(0, max).map((p) => (
        <PlateChip key={p} plate={p} />
      ))}
      {more > 0 ? (
        <span className="text-xs text-muted-foreground" title={plates.slice(max).join(", ")}>
          {tr("+{0} คัน", more)}
        </span>
      ) : null}
    </div>
  );
}
