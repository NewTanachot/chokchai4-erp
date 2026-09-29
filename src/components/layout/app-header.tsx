"use client";
import Link from "next/link";
import { Clock, ShoppingBag, ShoppingCart } from "lucide-react";
import { UserMenu } from "@/components/auth/user-menu";
import { LanguageToggle } from "@/components/language-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";
import { LOCALE, tr } from "@/lib/i18n";

function Today() {
  const text = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(Date.now());
  return <span className="hidden text-sm text-muted-foreground lg:inline" suppressHydrationWarning>{text}</span>;
}

export function AppHeader() {
  const { can } = useAuth();
  return (
    <header className="app-drag sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
      <Today />
      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" aria-label={tr("ลงเวลาทำงาน")}>
              <Link href="/clock/" data-shot="header-clock">
                <Clock />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tr("ลงเวลาเข้า-ออกงาน")}</TooltipContent>
        </Tooltip>
        {can("purchases.create") ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/transactions/new/?type=purchase">
              <ShoppingBag /> {tr("บันทึกซื้อ")}
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm">
          <Link href="/transactions/new/?type=sale">
            <ShoppingCart /> {tr("ขาย")}
          </Link>
        </Button>
        <LanguageToggle />
        <ThemeToggle />
        <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-5" />
        <UserMenu />
      </div>
    </header>
  );
}
