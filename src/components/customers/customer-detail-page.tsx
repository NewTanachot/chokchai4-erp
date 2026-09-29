"use client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  Car,
  FileText,
  Gauge,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Receipt,
  RotateCcw,
  ShoppingCart,
  StickyNote,
  Store,
  Trash2,
  UserX,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CustomerDetail } from "@shared/contract";
import { EntityHistoryCard } from "@/components/audit/entity-history";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParam } from "@/hooks/use-search-param";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBaht, formatDate } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { CustomerAvatar } from "./customer-avatar";
import { CustomerFormDialog } from "./customer-form-dialog";
import { CustomerHistory } from "./customer-history";
import { DeleteCustomerDialog } from "./delete-customer-dialog";
import { newSaleHref, relativeTime } from "./customer-utils";

function BackLink() {
  return (
    <Link href="/customers/" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> {tr("ลูกค้าทั้งหมด")}
    </Link>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  copyLabel,
  multiline,
  numeric,
}: {
  icon: typeof Phone;
  label: string;
  value: string | null;
  copyLabel?: string;
  multiline?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        {value ? (
          <div className={cn("text-sm break-words", multiline && "whitespace-pre-line", numeric && "num")}>{value}</div>
        ) : (
          <div className="text-sm text-muted-foreground/70">{tr("ยังไม่มีข้อมูล")}</div>
        )}
      </div>
      {value && copyLabel ? <CopyButton value={value} label={copyLabel} size="icon-sm" className="mt-1" /> : null}
    </div>
  );
}

function ProfileCard({ c }: { c: CustomerDetail }) {
  return (
    <Card className="gap-0" data-shot="customer-profile">
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{tr("ข้อมูลติดต่อ")}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        <ContactRow icon={Phone} label={tr("เบอร์โทร")} value={c.phone} copyLabel={tr("เบอร์โทร")} numeric />
        <ContactRow icon={MessageCircle} label="LINE ID" value={c.lineId} copyLabel="LINE ID" />
        <ContactRow icon={Mail} label={tr("อีเมล")} value={c.email} copyLabel={tr("อีเมล")} />
        {c.shopName ? <ContactRow icon={Store} label={tr("ชื่อร้านค้า / บริษัท")} value={c.shopName} /> : null}
        {c.taxId ? <ContactRow icon={FileText} label={tr("เลขประจำตัวผู้เสียภาษี")} value={c.taxId} copyLabel={tr("เลขผู้เสียภาษี")} numeric /> : null}
        {c.address ? <ContactRow icon={MapPin} label={tr("ที่อยู่")} value={c.address} copyLabel={tr("ที่อยู่")} multiline /> : null}
        {c.note ? <ContactRow icon={StickyNote} label={tr("หมายเหตุ")} value={c.note} multiline /> : null}
      </CardContent>
      <div className="mt-2 border-t px-4 pt-3 text-xs text-muted-foreground">{tr("เพิ่มในระบบเมื่อ {0}", formatDate(c.createdAt))}</div>
    </Card>
  );
}

function VehiclesCard({ c }: { c: CustomerDetail }) {
  return (
    <Card className="gap-0" data-shot="customer-vehicles">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{tr("รถที่เคยนำมา")}</CardTitle>
        <CardDescription>{c.vehicles.length ? tr("{0} คัน · จากทะเบียนในบิล", c.vehicles.length) : tr("จากทะเบียนรถในบิลขาย")}</CardDescription>
      </CardHeader>
      <CardContent>
        {c.vehicles.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            <Car className="size-5 shrink-0" />
            {tr("ยังไม่มีข้อมูลรถ — จะแสดงเมื่อบันทึกทะเบียนรถในบิล")}
          </div>
        ) : (
          <ul className="space-y-2">
            {c.vehicles.map((v) => (
              <li key={v.plate} className="flex items-start gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Car className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold break-words">{v.plate}</div>
                  <div className="text-sm text-muted-foreground">{v.model ?? tr("ไม่ระบุรุ่นรถ")}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      {tr("มา {0} ครั้ง · ล่าสุด {1}", v.visitCount, relativeTime(v.lastSeenAt))}
                    </span>
                    {v.lastMileage != null ? (
                      <span className="inline-flex items-center gap-1">
                        <Gauge className="size-3.5" />
                        <span className="num">{v.lastMileage.toLocaleString(LOCALE)}</span> {tr("กม.")}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Phone;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "expense" | "income" | "muted";
}) {
  return (
    <Card size="sm" className="gap-1.5 px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div
        className={cn(
          "num truncate text-xl leading-tight font-semibold",
          tone === "expense" && "text-expense",
          tone === "income" && "text-income",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

function KpiRow({ c }: { c: CustomerDetail }) {
  const avg = c.saleCount ? Math.round(c.totalSpent / c.saleCount) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4" data-shot="customer-kpis">
      <Kpi
        icon={Receipt}
        label={tr("มาใช้บริการ")}
        value={
          <>
            {c.saleCount.toLocaleString(LOCALE)} <span className="text-base font-medium text-muted-foreground">{tr("ครั้ง")}</span>
          </>
        }
        sub={c.saleCount ? tr("นับเฉพาะบิลขายที่ไม่ยกเลิก") : tr("ยังไม่มีบิลขาย")}
      />
      <Kpi icon={Banknote} label={tr("ยอดซื้อรวม")} value={formatBaht(c.totalSpent)} sub={c.saleCount ? tr("เฉลี่ย {0} / ครั้ง", formatBaht(avg)) : "—"} />
      <Kpi
        icon={Wallet}
        label={tr("ค้างชำระ")}
        value={formatBaht(c.unpaidTotal)}
        tone={c.unpaidTotal > 0 ? "expense" : "muted"}
        sub={c.unpaidTotal > 0 ? tr("{0} บิลยังไม่ชำระ", c.unpaidCount) : tr("ไม่มียอดค้าง")}
      />
      <Kpi
        icon={CalendarClock}
        label={tr("มาครั้งแรก / ล่าสุด")}
        value={c.lastVisitAt ? relativeTime(c.lastVisitAt) : tr("ยังไม่เคยมา")}
        tone={c.lastVisitAt ? undefined : "muted"}
        sub={c.firstVisitAt ? tr("ครั้งแรก {0}", formatDate(c.firstVisitAt)) : "—"}
      />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <>
      <Skeleton className="mb-3 h-4 w-28" />
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[21rem_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-xl" />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    </>
  );
}

function NotFound({ message }: { message?: string }) {
  return (
    <>
      <BackLink />
      <Empty className="border bg-card py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-14 rounded-2xl [&_svg:not([class*='size-'])]:size-7">
            <UserX />
          </EmptyMedia>
          <EmptyTitle className="text-lg">{tr("ไม่พบข้อมูลลูกค้า")}</EmptyTitle>
          <EmptyDescription>{message ?? tr("ลูกค้าคนนี้อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild size="lg">
            <Link href="/customers/">{tr("กลับไปหน้ารายชื่อลูกค้า")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </>
  );
}

export function CustomerDetailPage() {
  const id = useSearchParam("id");
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("customers.manage");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: c, isPending, isError, error, refetch } = useQuery({
    queryKey: ["customers", "get", id],
    queryFn: () => api.customers.get(id!),
    enabled: !!id,
  });

  const remove = useApiMutation(
    async (customerId: string) => {
      await api.customers.remove(customerId);
      // Leave before queries are invalidated so this page does not flash "not found".
      router.replace("/customers/");
    },
    { successMessage: tr("ลบลูกค้าแล้ว") },
  );

  if (!id) return <NotFound message={tr("ไม่ได้ระบุลูกค้าที่ต้องการดู")} />;
  if (isPending) return <DetailSkeleton />;
  if (isError) {
    if (error instanceof ApiClientError && error.code === "NOT_FOUND") return <NotFound />;
    return (
      <>
        <BackLink />
        <Alert variant="destructive">
          <AlertTitle>{tr("โหลดข้อมูลลูกค้าไม่สำเร็จ")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RotateCcw /> {tr("ลองใหม่")}
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-4">
            <CustomerAvatar name={c.name} colorKey={c.id} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{c.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm font-normal tracking-normal text-muted-foreground">
                {c.shopName ? (
                  <span className="inline-flex items-center gap-1">
                    <Store className="size-3.5" /> {c.shopName}
                  </span>
                ) : null}
                <span>{c.saleCount > 0 ? tr("ลูกค้าตั้งแต่ {0}", formatDate(c.firstVisitAt!)) : tr("ลูกค้าใหม่ · ยังไม่มีบิล")}</span>
                {c.unpaidTotal > 0 ? (
                  <span className="inline-flex h-5 items-center rounded-full bg-expense/10 px-2 text-xs font-medium text-expense">
                    {tr("ค้างชำระ {0}", formatBaht(c.unpaidTotal))}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {canManage ? (
              <>
                <Button variant="ghost" size="lg" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteOpen(true)} data-shot="delete-customer">
                  <Trash2 /> {tr("ลบ")}
                </Button>
                <Button variant="outline" size="lg" onClick={() => setEditOpen(true)} data-shot="edit-customer">
                  <Pencil /> {tr("แก้ไข")}
                </Button>
              </>
            ) : null}
            <Button asChild size="lg" className="px-4">
              <Link href={newSaleHref(c.id)} data-shot="new-sale">
                <ShoppingCart /> {tr("เปิดบิลขาย")}
              </Link>
            </Button>
          </>
        }
      />

      {/* Narrow: KPIs -> contact/vehicles -> history. Wide (xl): contact/vehicles as a left column. */}
      <div className="grid items-start gap-4 xl:grid-cols-[21rem_minmax(0,1fr)] xl:grid-rows-[auto_1fr]">
        <div className="@container min-w-0 xl:col-start-2 xl:row-start-1">
          <KpiRow c={c} />
        </div>
        <div className="grid items-start gap-4 md:grid-cols-2 xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:grid-cols-1">
          <ProfileCard c={c} />
          <VehiclesCard c={c} />
        </div>
        <div className="min-w-0 xl:col-start-2 xl:row-start-2">
          <CustomerHistory customerId={c.id} customerName={c.name} />
        </div>
      </div>

      {can("audit.view") ? <EntityHistoryCard entityType="customer" entityId={c.id} className="mt-4" title={tr("ประวัติการแก้ไขข้อมูลลูกค้า")} description={tr("ใครเพิ่มหรือแก้ไขข้อมูลติดต่อของลูกค้านี้")} /> : null}

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={c} />
      <DeleteCustomerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={c.name}
        billCount={c.saleCount}
        pending={remove.isPending}
        onConfirm={() => remove.mutate(c.id)}
      />
    </>
  );
}
