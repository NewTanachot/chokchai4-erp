"use client";
import { Boxes, Clock, DatabaseBackup, Hash, Info, Palette, Percent, Printer, RefreshCw, Store, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import type { Permission } from "@shared/contract";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AboutSection } from "./about-section";
import { BackupSection } from "./backup-section";
import { DisplaySection } from "./display-section";
import { DocsSection } from "./docs-section";
import { InventorySection } from "./inventory-section";
import { PayrollSection } from "./payroll-section";
import { PrintSection } from "./print-section";
import { ShopSection } from "./shop-section";
import { TaxSection } from "./tax-section";
import { DirtyContext, SETTINGS_QUERY_KEY } from "./use-section-form";
import { UsersSection } from "./users-section";

/** `permission`: who sees the section ("owner" = owners only, none = everyone). */
export const SETTINGS_SECTIONS = [
  { id: "shop", label: tr("ข้อมูลร้าน"), icon: Store, permission: "settings.manage" },
  { id: "tax", label: tr("ภาษี (VAT)"), icon: Percent, permission: "settings.manage" },
  { id: "docs", label: tr("เลขที่เอกสาร"), icon: Hash, permission: "settings.manage" },
  { id: "print", label: tr("การพิมพ์"), icon: Printer, permission: "settings.manage" },
  { id: "stock", label: tr("สต็อก"), icon: Boxes, permission: "settings.manage" },
  { id: "payroll", label: tr("เวลางาน & เงินเดือน"), icon: Clock, permission: "employees.manage" },
  { id: "users", label: tr("ผู้ใช้งาน"), icon: Users, permission: "owner" },
  { id: "backup", label: tr("สำรองข้อมูล"), icon: DatabaseBackup, permission: "settings.manage" },
  { id: "display", label: tr("การแสดงผล"), icon: Palette },
  { id: "about", label: tr("เกี่ยวกับโปรแกรม"), icon: Info },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon; permission?: Permission | "owner" }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Sections that edit AppSettings (need the settings query). */
const NEEDS_SETTINGS = new Set<SettingsSectionId>(["shop", "tax", "docs", "print", "stock", "payroll", "users", "backup"]);

export function SettingsView() {
  const router = useRouter();
  const { can, isOwner } = useAuth();
  const sections = SETTINGS_SECTIONS.filter((s) => !("permission" in s) || (s.permission === "owner" ? isOwner : can(s.permission)));
  const visible = new Set<SettingsSectionId>(sections.map((s) => s.id));
  const param = useSearchParam("section");
  const active: SettingsSectionId = sections.find((s) => s.id === param)?.id ?? sections[0].id;
  const settings = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => api.settings.get() });

  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const reportDirty = useCallback((id: string, d: boolean) => setDirty((m) => (!!m[id] === d ? m : { ...m, [id]: d })), []);

  const go = (id: SettingsSectionId) => {
    if (id !== active) router.replace(`/settings/?section=${id}`);
  };

  const s = settings.data;
  // All sections stay mounted (hidden) so unsaved edits survive switching sections.
  const panel = (id: SettingsSectionId, node: React.ReactNode) => (
    <div key={id} hidden={active !== id} role="tabpanel" aria-labelledby={`settings-tab-${id}`} data-section={id}>
      {node}
    </div>
  );

  return (
    <DirtyContext.Provider value={reportDirty}>
      <PageHeader
        title={tr("ตั้งค่า")}
        description={
          isOwner
            ? tr("ข้อมูลร้าน ภาษี เอกสาร การพิมพ์ ผู้ใช้งาน และการสำรองข้อมูล")
            : can("settings.manage")
              ? tr("ข้อมูลร้าน ภาษี เอกสาร การพิมพ์ และการสำรองข้อมูล")
              : tr("ภาษา ธีมสี และข้อมูลเวอร์ชันของโปรแกรม")
        }
      />
      <div className="@container/page">
        <div className="grid gap-6 @2xl/page:grid-cols-[11rem_minmax(0,1fr)] @2xl/page:gap-6 @4xl/page:grid-cols-[13.5rem_minmax(0,1fr)] @4xl/page:gap-8">
          <nav aria-label={tr("หมวดการตั้งค่า")} className="self-start @2xl/page:sticky @2xl/page:top-20">
            <div role="tablist" aria-orientation="vertical" className="flex flex-wrap gap-1 @2xl/page:flex-col @2xl/page:flex-nowrap">
              {sections.map((sec) => {
                const isActive = sec.id === active;
                const Icon = sec.icon;
                return (
                  <button
                    key={sec.id}
                    id={`settings-tab-${sec.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => go(sec.id)}
                    data-shot={`section-${sec.id}`}
                    className={cn(
                      "flex h-10 items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      "border border-transparent @2xl/page:w-full",
                      isActive
                        ? "border-border bg-card font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                    <span className="flex-1 truncate">{sec.label}</span>
                    {dirty[sec.id] ? (
                      <span className="size-2 shrink-0 rounded-full bg-warning" title={tr("มีการแก้ไขที่ยังไม่บันทึก")}>
                        <span className="sr-only">{tr("มีการแก้ไขที่ยังไม่บันทึก")}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="@container/settings min-w-0 max-w-4xl">
            {NEEDS_SETTINGS.has(active) && settings.isPending ? <SectionSkeleton /> : null}
            {NEEDS_SETTINGS.has(active) && settings.isError ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{tr("โหลดการตั้งค่าไม่สำเร็จ")}</AlertTitle>
                <AlertDescription>
                  <p>{errorMessage(settings.error)}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void settings.refetch()}>
                    <RefreshCw /> {tr("ลองอีกครั้ง")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {s ? (
              <>
                {visible.has("shop") ? panel("shop", <ShopSection saved={s.shop} />) : null}
                {visible.has("tax") ? panel("tax", <TaxSection saved={s.tax} />) : null}
                {visible.has("docs") ? panel("docs", <DocsSection saved={s.docs} />) : null}
                {visible.has("print") ? panel("print", <PrintSection saved={s.print} />) : null}
                {visible.has("stock") ? panel("stock", <InventorySection saved={s.inventory} />) : null}
                {visible.has("payroll") ? panel("payroll", <PayrollSection saved={s.payroll} />) : null}
                {visible.has("users") ? panel("users", <UsersSection security={s.security} />) : null}
                {visible.has("backup") ? panel("backup", <BackupSection saved={s.backup} />) : null}
              </>
            ) : null}
            {panel("display", <DisplaySection />)}
            {panel("about", <AboutSection />)}
          </div>
        </div>
      </div>
    </DirtyContext.Provider>
  );
}

export function SectionSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 border-b p-4">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SettingsFallback() {
  return (
    <>
      {/* The real subtitle depends on the user's access; keep its line so the page doesn't jump. */}
      <PageHeader title={tr("ตั้งค่า")} description={"\u00a0"} />
      <SectionSkeleton />
    </>
  );
}
