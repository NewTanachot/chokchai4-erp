"use client";
import { Suspense } from "react";
import { RequirePermission } from "@/components/auth/require-permission";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportsView } from "@/components/reports/reports-view";

export default function ReportsPage() {
  return (
    <RequirePermission permission="reports.view">
      <Suspense
        fallback={
          <div className="flex flex-col gap-5">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-11 w-full max-w-2xl" />
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          </div>
        }
      >
        <ReportsView />
      </Suspense>
    </RequirePermission>
  );
}
