"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { SETTINGS_NAV, isNavActive, visibleNav, type NavItem } from "./nav";

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const active = isNavActive(item, pathname, search);
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title} size="lg" className="h-10">
        <Link href={item.href}>
          <Icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { can } = useAuth();
  const groups = visibleNav(can);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="app-drag mac-traffic-pad">
        <Link href="/" className="flex items-center gap-3 rounded-lg px-1 py-1.5" data-no-drag>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="size-10 shrink-0 rounded-full bg-white/90 shadow-sm ring-1 ring-white/20" />
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[15px] font-semibold text-sidebar-accent-foreground">{tr("โชคชัย 4 ยางยนต์")}</span>
            <span className="truncate text-xs text-sidebar-foreground/70">{tr("ยาง · ช่วงล่าง · แบตเตอรี่")}</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <Suspense>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-sidebar-foreground/60">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </Suspense>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <Suspense>
            <NavLink item={SETTINGS_NAV} />
          </Suspense>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
