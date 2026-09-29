"use client";
import { AttendancePage } from "@/components/attendance/attendance-page";
import { RequirePermission } from "@/components/auth/require-permission";

/** /attendance/ — เวลาทำงาน: today's board, monthly summary, corrections and leave. */
export default function AttendanceRoute() {
  return (
    <RequirePermission permission={["attendance.manage", "employees.manage"]}>
      <AttendancePage />
    </RequirePermission>
  );
}
