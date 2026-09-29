"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import type { AuditEntityType } from "@shared/contract";
import { Pager } from "@/components/catalog/shared";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AuditEntryView } from "./audit-entry";

const PAGE = 10;

/** "ประวัติการแก้ไข" of one record, newest first. Only render for users with audit.view (or the record's manager). */
export function EntityHistoryCard({
  entityType,
  entityId,
  title = tr("ประวัติการแก้ไข"),
  description = tr("ใครทำอะไรกับรายการนี้ เมื่อไหร่ เรียงจากล่าสุด"),
  className,
}: {
  entityType: AuditEntityType;
  entityId: string;
  title?: string;
  description?: string;
  className?: string;
}) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["audit", "list", { entityType, entityId, offset }],
    queryFn: () => api.audit.list({ entityType, entityId, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const items = q.data?.items ?? [];
  return (
    <Card className={cn("gap-0 py-0", className)} data-shot="entity-history">
      <CardHeader className="flex flex-row items-center gap-3 border-b py-4">
        <History className="size-5 text-muted-foreground" />
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      {q.isPending ? (
        <div className="space-y-4 p-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="p-6 text-center text-sm text-destructive">{errorMessage(q.error)}</p>
      ) : items.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{tr("ยังไม่มีประวัติ (รายการที่สร้างก่อนมีระบบผู้ใช้จะไม่มีประวัติย้อนหลัง)")}</p>
      ) : (
        <>
          <ol className={cn("divide-y", q.isPlaceholderData && "opacity-60")}>
            {items.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <AuditEntryView entry={e} />
              </li>
            ))}
          </ol>
          <Pager className="border-t px-4 py-3" offset={offset} limit={PAGE} total={q.data?.total ?? 0} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}
