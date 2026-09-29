"use client";
import { ChevronRight, FolderOpen, Info, Tags, WifiOff, Wrench } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { SectionCard } from "./section-card";

const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

export function AboutSection() {
  const { can } = useAuth();
  const info = useQuery({ queryKey: ["system", "info"], queryFn: () => api.system.info(), retry: false });
  const open = useApiMutation(() => api.system.openDataFolder());
  const d = info.data;

  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = d
    ? [
        { label: tr("ชื่อโปรแกรม"), value: d.appName },
        { label: tr("เวอร์ชัน"), value: <span className="num">{d.version}</span> },
        { label: tr("ระบบปฏิบัติการ"), value: PLATFORM[d.platform] ?? d.platform },
        { label: tr("สำรองอัตโนมัติล่าสุด"), value: d.lastAutoBackupAt ? formatDateTime(d.lastAutoBackupAt) : tr("ยังไม่เคย") },
        { label: tr("ตำแหน่งข้อมูล"), value: d.userDataPath, mono: true },
        { label: tr("ไฟล์ฐานข้อมูล"), value: d.dbPath, mono: true },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-5 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="size-20 shrink-0 rounded-full shadow-sm" />
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold tracking-tight">{tr("โชคชัย 4 ยางยนต์")}</div>
            <div className="text-sm text-muted-foreground">{tr("ระบบจัดการร้าน ยาง · ช่วงล่าง · แบตเตอรี่")}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {d ? <Badge variant="secondary" className="num">{tr("เวอร์ชัน {0}", d.version)}</Badge> : <Skeleton className="h-5 w-24" />}
              <Badge variant="outline">
                <WifiOff /> {tr("ทำงานออฟไลน์ ไม่ต้องใช้อินเทอร์เน็ต")}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      <SectionCard
        icon={Info}
        title={tr("ข้อมูลโปรแกรม")}
        action={
          can("settings.manage") ? (
            <Button type="button" variant="outline" onClick={() => open.mutate()} disabled={open.isPending || !d}>
              <FolderOpen /> {tr("เปิดโฟลเดอร์ข้อมูล")}
            </Button>
          ) : null
        }
      >
        {info.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : info.isError ? (
          <p className="text-sm text-muted-foreground">{errorMessage(info.error)}</p>
        ) : (
          <dl className="divide-y">
            {rows.map((r) => (
              <div key={r.label} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 @xl/settings:grid-cols-[11rem_minmax(0,1fr)] @xl/settings:gap-4">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className={r.mono ? "font-mono text-xs leading-6 break-all" : "text-sm font-medium"}>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </SectionCard>

      <SectionCard title={tr("ตั้งค่าข้อมูลอื่น ๆ")} description={tr("รายการเหล่านี้จัดการได้ในหน้าของแต่ละเมนู")} contentClassName="px-2 py-2">
        <div className="flex flex-col">
          <QuickLink href="/products/" icon={Tags} title={tr("จัดการหมวดหมู่สินค้า")} hint={tr("เพิ่ม / แก้ไข / เรียงลำดับหมวดหมู่ ที่หน้าสินค้า & สต็อก")} />
          <QuickLink href="/services/" icon={Wrench} title={tr("จัดการรายการบริการ")} hint={tr("ค่าแรง ค่าบริการ และราคาเริ่มต้น")} />
        </div>
      </SectionCard>
    </div>
  );
}

function QuickLink({ href, icon: Icon, title, hint }: { href: string; icon: typeof Tags; title: string; hint: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60" data-shot={`link-${href}`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
