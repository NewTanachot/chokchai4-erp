"use client";
import { Suspense } from "react";
import { BillFormSkeleton, NewBillPage } from "@/components/transactions/bill-pages";

/** /transactions/new/?type=sale|purchase[&customerId=...][&from=<bill id to copy>] */
export default function Page() {
  return (
    <Suspense fallback={<BillFormSkeleton />}>
      <NewBillPage />
    </Suspense>
  );
}
