"use client";
import { Suspense } from "react";
import { CustomerDetailPage } from "@/components/customers/customer-detail-page";

export default function Page() {
  return (
    <Suspense>
      <CustomerDetailPage />
    </Suspense>
  );
}
