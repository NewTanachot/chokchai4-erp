"use client";
/** Route bodies for /transactions/new/ and /transactions/edit/ (wrap in <Suspense>: they read the query string). */
import { useQuery } from "@tanstack/react-query";
import { Ban, FileQuestion } from "lucide-react";
import Link from "next/link";
import type { TransactionType } from "@shared/contract";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParam } from "@/hooks/use-search-param";
import { api, errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { draftCopyOf, draftFromDetail, emptyDraft, type BillDraft } from "./bill-draft";
import { BillForm } from "./bill-form";
import { toDraftCustomer } from "./customer-picker";
import { useSettings } from "./hooks";
import { txHref } from "./labels";

export function BillFormSkeleton() {
  return (
    <div aria-busy>
      <div className="mb-5 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-3 p-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </Card>
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function Problem({ title, description, icon: Icon = FileQuestion }: { title: string; description: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <Empty className="mt-10 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link href="/transactions/">{tr("ไปที่รายการซื้อ-ขาย")}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function NewBillPage() {
  const type: TransactionType = useSearchParam("type") === "purchase" ? "purchase" : "sale";
  const customerId = useSearchParam("customerId");
  const from = useSearchParam("from");
  const { settings, loaded } = useSettings();

  const customer = useQuery({
    queryKey: ["customers", "get", customerId],
    queryFn: () => api.customers.get(customerId!),
    enabled: !!customerId,
  });
  const source = useQuery({
    queryKey: ["transactions", "get", from],
    queryFn: () => api.transactions.get(from!),
    enabled: !!from,
  });
  // The doc number preview follows the draft's date, so BillForm fetches it (useNextDocNo).

  if (!loaded || (customerId && customer.isPending) || (from && source.isPending)) return <BillFormSkeleton />;

  let initial: BillDraft = emptyDraft(settings, type);
  if (source.data && source.data.type === type) initial = draftCopyOf(source.data, settings);
  if (customer.data) initial = { ...initial, customer: toDraftCustomer(customer.data) };
  if (customer.data && type === "sale" && !initial.vehiclePlate && customer.data.vehiclePlates.length === 1) {
    const v = customer.data.vehicles?.find((x) => x.plate === customer.data.vehiclePlates[0]);
    initial = { ...initial, vehiclePlate: customer.data.vehiclePlates[0], vehicleModel: initial.vehicleModel || v?.model || "" };
  }

  const form = <BillForm key={`${type}|${customerId ?? ""}|${from ?? ""}`} type={type} mode="new" initial={initial} />;
  return type === "purchase" ? <RequirePermission permission="purchases.create">{form}</RequirePermission> : form;
}

export function EditBillPage() {
  const id = useSearchParam("id");
  const { settings, loaded } = useSettings();
  const bill = useQuery({
    queryKey: ["transactions", "get", id],
    queryFn: () => api.transactions.get(id!),
    enabled: !!id,
    // the form keeps its own copy; don't refetch underneath it
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const customerId = bill.data?.customerId ?? null;
  const customer = useQuery({
    queryKey: ["customers", "get", customerId],
    queryFn: () => api.customers.get(customerId!),
    enabled: !!customerId,
    retry: false,
  });

  if (!id) return <Problem title={tr("ไม่พบบิล")} description={tr("ลิงก์ไม่ถูกต้อง กรุณาเลือกบิลจากรายการซื้อ-ขาย")} />;
  if (bill.isError) return <Problem title={tr("ไม่พบบิลนี้")} description={errorMessage(bill.error)} />;
  if (!loaded || bill.isPending || (customerId && customer.isPending)) return <BillFormSkeleton />;
  const d = bill.data;
  if (d.status === "void") {
    return (
      <Problem
        icon={Ban}
        title={tr("บิล {0} ถูกยกเลิกแล้ว", d.docNo)}
        description={
          <>
            {tr("บิลที่ยกเลิกแล้วแก้ไขไม่ได้ — ")}
            <Link href={txHref.view(d.id)} className="text-primary">
              {tr("ดูรายละเอียดบิล")}
            </Link>{tr(" หรือเปิดบิลใหม่แทน")}
          </>
        }
      />
    );
  }
  let initial = draftFromDetail(d, settings);
  if (initial.customer && customer.data) initial = { ...initial, customer: { ...initial.customer, vehiclePlates: customer.data.vehiclePlates } };
  const form = <BillForm key={d.id} type={d.type} mode="edit" initial={initial} original={d} />;
  return (
    <RequirePermission permission="transactions.edit">
      {d.type === "purchase" ? <RequirePermission permission="purchases.create">{form}</RequirePermission> : form}
    </RequirePermission>
  );
}
