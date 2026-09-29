"use client";
import { Suspense } from "react";
import { BillViewPage } from "@/components/transactions/bill-view-page";

/** /transactions/view/?id=...[&print=1] */
export default function Page() {
  return (
    <Suspense>
      <BillViewPage />
    </Suspense>
  );
}
