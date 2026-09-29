import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Tone = "default" | "warning" | "danger" | "success";

const ICON_TONE: Record<Tone, string> = {
  default: "bg-primary/10 text-primary dark:bg-primary/15",
  success: "bg-income/12 text-income dark:bg-income/15",
  warning: "bg-warning/25 text-warning-foreground dark:bg-warning/20 dark:text-warning",
  danger: "bg-destructive/10 text-destructive dark:bg-destructive/20",
};

/** KPI tile: icon, label, big value and an optional sub line. Clickable when `onClick` is given. */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  loading,
  onClick,
  active,
  className,
  ...rest
}: {
  icon: LucideIcon;
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  loading?: boolean;
  onClick?: () => void;
  active?: boolean;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">) {
  const body = (
    <div className="flex items-start gap-3 px-4">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", ICON_TONE[tone])}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-muted-foreground">{label}</div>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-28" />
        ) : (
          <div className="num mt-0.5 truncate text-2xl font-semibold tracking-tight">{value}</div>
        )}
        {sub ? <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{sub}</div> : null}
      </div>
    </div>
  );
  return (
    <Card
      {...rest}
      className={cn(
        "gap-0 py-4",
        onClick && "cursor-pointer transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "ring-2 ring-primary/60 hover:bg-card",
        className,
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? !!active : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {body}
    </Card>
  );
}
