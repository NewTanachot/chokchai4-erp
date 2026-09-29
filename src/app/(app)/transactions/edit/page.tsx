"use client";
import { Suspense } from "react";
import { BillFormSkeleton, EditBillPage } from "@/components/transactions/bill-pages";

/** /transactions/edit/?id=... */
export default function Page() {
  return (
    <Suspense fallback={<BillFormSkeleton />}>
      <EditBillPage />
    </Suspense>
  );
}
