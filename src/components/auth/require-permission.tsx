"use client";
import { ShieldX } from "lucide-react";
import Link from "next/link";
import { PERMISSION_INFO, type Permission } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useAuth } from "@/lib/auth";
import { tr } from "@/lib/i18n";

/** Renders the page only for users with the permission (any of a list), "owner" = owners only. */
export function RequirePermission({ permission, children }: { permission: Permission | Permission[] | "owner"; children: React.ReactNode }) {
  const { can, isOwner } = useAuth();
  const list = permission === "owner" ? [] : Array.isArray(permission) ? permission : [permission];
  const allowed = permission === "owner" ? isOwner : list.some(can);
  if (allowed) return <>{children}</>;
  const what = permission === "owner" ? tr("เฉพาะเจ้าของร้าน") : tr("ต้องมีสิทธิ์ \"{0}\"", list.map((p) => PERMISSION_INFO[p].label).join(tr('" หรือ "')));
  return (
    <Empty className="mt-10 border">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
          <ShieldX />
        </EmptyMedia>
        <EmptyTitle className="text-base">{tr("ไม่มีสิทธิ์เข้าถึงหน้านี้")}</EmptyTitle>
        <EmptyDescription>{tr("{0} — ถ้าต้องใช้งาน กรุณาให้เจ้าของร้านเพิ่มสิทธิ์ให้ที่ ตั้งค่า → ผู้ใช้งาน", what)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="lg">
          <Link href="/">{tr("กลับหน้าแรก")}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
