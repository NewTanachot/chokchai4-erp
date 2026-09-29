"use client";
import { RequirePermission } from "@/components/auth/require-permission";
import { PayrollListPage } from "@/components/payroll/payroll-list-page";

/** /payroll/ — งวดเงินเดือน */
export default function PayrollPage() {
  return (
    <RequirePermission permission="employees.manage">
      <PayrollListPage />
    </RequirePermission>
  );
}
