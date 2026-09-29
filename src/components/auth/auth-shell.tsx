"use client";
import { LanguageToggle } from "@/components/language-toggle";
import { cn } from "@/lib/utils";

/**
 * Full-window background for the login / first-run screens (the macOS title bar area stays draggable), with the
 * language switch in the top-right corner.
 */
export function AuthShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative flex min-h-svh flex-col bg-sidebar text-foreground">
      <div className="app-drag relative z-10 flex h-12 shrink-0 items-center justify-end px-4">
        <LanguageToggle className="text-sidebar-foreground/80 hover:bg-white/10 hover:text-sidebar-accent-foreground dark:hover:bg-white/10" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(1_0_0/0.10),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.75_0.1_275/0.12),transparent_60%)]"
      />
      <main className={cn("relative flex flex-1 items-start justify-center px-4 pt-2 pb-10 sm:items-center sm:pt-0", className)}>{children}</main>
    </div>
  );
}

/** Logo + shop name above the card. */
export function AuthBrand({ shopName, subtitle }: { shopName: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center text-sidebar-accent-foreground">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="size-20 rounded-full bg-white/90 shadow-lg ring-1 ring-white/20" />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{shopName}</h1>
      {subtitle ? <p className="mt-1 text-sm text-sidebar-foreground/75">{subtitle}</p> : null}
    </div>
  );
}
