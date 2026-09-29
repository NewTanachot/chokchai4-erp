import { cn } from "@/lib/utils";
import { avatarTone, customerInitial } from "./customer-utils";

const SIZES = {
  sm: "size-8 text-sm",
  md: "size-10 text-base",
  lg: "size-14 text-2xl",
} as const;

/** Round avatar with the customer's initial, coloured deterministically from the id/name. */
export function CustomerAvatar({
  name,
  colorKey,
  size = "md",
  className,
}: {
  name: string;
  colorKey?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none select-none",
        SIZES[size],
        avatarTone(colorKey ?? name),
        className,
      )}
    >
      {customerInitial(name)}
    </span>
  );
}
