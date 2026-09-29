"use client";
import { Suspense } from "react";
import { RequirePermission } from "@/components/auth/require-permission";
import { EmployeeDetailPage } from "@/components/employees/employee-detail-page";

/** /employees/view/?id=... */
export default function EmployeeViewPage() {
  return (
    <RequirePermission permission="employees.manage">
      <Suspense>
        <EmployeeDetailPage />
      </Suspense>
    </RequirePermission>
  );
}
