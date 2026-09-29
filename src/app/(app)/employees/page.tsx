"use client";
import { RequirePermission } from "@/components/auth/require-permission";
import { EmployeeListPage } from "@/components/employees/employee-list-page";

/** /employees/ — ข้อมูลพนักงาน (personal data and pay: employees.manage). */
export default function EmployeesPage() {
  return (
    <RequirePermission permission="employees.manage">
      <EmployeeListPage />
    </RequirePermission>
  );
}
