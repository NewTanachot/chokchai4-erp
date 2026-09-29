"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag, ShoppingCart, UserPlus } from "lucide-react";
import { DEFAULT_SETTINGS } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateLong } from "@/lib/format";
import { greeting } from "@/components/reports/format";
import { tr } from "@/lib/i18n";

/** Greeting + Thai date on the left, the three most common actions on the right. */
export function Greeting({ now }: { now: number }) {
  const settings = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get() });
  const shopName = settings.data?.shop.name || DEFAULT_SETTINGS.shop.name;
  const { user, can } = useAuth();
  return (
    // One row from ~670 px up (the text truncates before the buttons wrap), stacked below that.
    <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center @2xl:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt=""
          className="hidden size-12 shrink-0 rounded-full bg-white shadow-sm ring-1 ring-foreground/10 @4xl:block"
        />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight" suppressHydrationWarning>
            {greeting(new Date(now))} {user.name}
          </h1>
          <p className="truncate text-sm text-muted-foreground" suppressHydrationWarning>
            {formatDateLong(now)} · {shopName}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="lg" className="px-3.5">
          <Link href="/customers/?new=1" data-shot="dash-new-customer">
            <UserPlus /> {tr("เพิ่มลูกค้า")}
          </Link>
        </Button>
        {can("purchases.create") ? (
          <Button asChild variant="outline" size="lg" className="px-3.5">
            <Link href="/transactions/new/?type=purchase" data-shot="dash-new-purchase">
              <ShoppingBag /> {tr("บันทึกการซื้อ")}
            </Link>
          </Button>
        ) : null}
        <Button asChild size="lg" className="px-4">
          <Link href="/transactions/new/?type=sale" data-shot="dash-new-sale">
            <ShoppingCart /> {tr("ขายสินค้า / บริการ")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
