"use client";
import { Suspense } from "react";
import { CustomerListPage } from "@/components/customers/customer-list-page";

export default function Page() {
  return (
    <Suspense>
      <CustomerListPage />
    </Suspense>
  );
}
