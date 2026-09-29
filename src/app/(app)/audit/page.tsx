"use client";
import { AuditFeed } from "@/components/audit/audit-feed";
import { RequirePermission } from "@/components/auth/require-permission";

/** /audit/ — ประวัติการแก้ไข: who changed what, across the whole program. */
export default function AuditPage() {
  return (
    <RequirePermission permission="audit.view">
      <AuditFeed />
    </RequirePermission>
  );
}
