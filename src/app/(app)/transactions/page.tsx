"use client";
import { Suspense } from "react";
import { TransactionListPage } from "@/components/transactions/transaction-list-page";

/** /transactions/[?type=sale|purchase][&range=today|yesterday|7d|month|all | &from=&to=][&q=][&paymentStatus=][&customerId=][&void=1] */
export default function Page() {
  return (
    <Suspense>
      <TransactionListPage />
    </Suspense>
  );
}
