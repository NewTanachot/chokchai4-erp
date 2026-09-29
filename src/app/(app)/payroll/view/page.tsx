"use client";
import { Suspense } from "react";
import { RequirePermission } from "@/components/auth/require-permission";
import { RunDetailPage } from "@/components/payroll/run-detail-page";

/** /payroll/view/?id=... — one pay period and its payslips. */
export default function PayrollRunPage() {
  return (
    <RequirePermission permission="employees.manage">
      <Suspense>
        <RunDetailPage />
      </Suspense>
    </RequirePermission>
  );
}
