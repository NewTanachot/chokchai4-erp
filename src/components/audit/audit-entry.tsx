"use client";
import { ArrowRight, Minus, Plus, SquarePen } from "lucide-react";
import Link from "next/link";
import type { AuditEntry, AuditItemChange } from "@shared/contract";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { formatBaht, formatDateTime, formatQty } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { auditHref, auditTitle, fieldMeta, formatAuditValue } from "./audit-format";

const lineText = (v: NonNullable<AuditItemChange["after"]>, unit: string | null) =>
  `${formatQty(v.qty)}${unit ? ` ${unit}` : ""} × ${formatBaht(v.unitPrice)}${v.discount ? tr(" ลด {0}", formatBaht(v.discount)) : ""} = ${formatBaht(v.total)}`;

function ItemChanges({ items }: { items: AuditItemChange[] }) {
  return (
    <ul className="mt-1.5 space-y-1 text-sm">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded",
              it.change === "added" ? "bg-income/12 text-income" : it.change === "removed" ? "bg-expense/12 text-expense" : "bg-primary/10 text-primary",
            )}
            aria-hidden
          >
            {it.change === "added" ? <Plus className="size-3.5" /> : it.change === "removed" ? <Minus className="size-3.5" /> : <SquarePen className="size-3" />}
          </span>
          <span className="min-w-0">
            <span className={cn("font-medium", it.change === "removed" && "line-through decoration-expense/60")}>{it.name}</span>{" "}
            {it.change === "added" && it.after ? (
              <span className="num text-muted-foreground">{tr("(เพิ่ม {0})", lineText(it.after, it.unit))}</span>
            ) : it.change === "removed" && it.before ? (
              <span className="num text-muted-foreground">{tr("(ลบ {0})", lineText(it.before, it.unit))}</span>
            ) : (
              <span className="text-muted-foreground">
                {it.fields.map((f, j) => (
                  <span key={f.field} className="num">
                    {j ? " · " : ""}
                    {fieldMeta("transaction", f.field).label} {formatAuditValue("transaction", f.field, f.from)} → <span className="text-foreground">{formatAuditValue("transaction", f.field, f.to)}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Field changes as "label: from → to" rows (create: just the values). */
export function AuditChanges({ entry }: { entry: AuditEntry }) {
  if (!entry.changes.length && !entry.items.length) return null;
  const isCreate = entry.action === "create";
  return (
    <div className="mt-1.5">
      {entry.changes.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
          {entry.changes.map((c) => (
            <div key={c.field} className="contents">
              <dt className="text-muted-foreground">{fieldMeta(entry.entityType, c.field).label}</dt>
              <dd className="num min-w-0 break-words">
                {isCreate || c.from === null ? (
                  formatAuditValue(entry.entityType, c.field, c.to)
                ) : c.to === null && (entry.action === "delete" || entry.action === "unpay") ? (
                  formatAuditValue(entry.entityType, c.field, c.from)
                ) : (
                  <>
                    <span className="text-muted-foreground line-through decoration-muted-foreground/50">{formatAuditValue(entry.entityType, c.field, c.from)}</span>
                    <ArrowRight className="mx-1 inline size-3.5 text-muted-foreground" />
                    <span className="font-medium">{formatAuditValue(entry.entityType, c.field, c.to)}</span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {entry.items.length ? <ItemChanges items={entry.items} /> : null}
    </div>
  );
}

/** One history entry: who, what, when, the changes. `showSubject` adds what it was about (for the global feed). */
export function AuditEntryView({ entry, showSubject = false, className }: { entry: AuditEntry; showSubject?: boolean; className?: string }) {
  const href = showSubject ? auditHref(entry) : null;
  const who = entry.userName ?? (entry.action === "login_failed" ? tr("ไม่ทราบ") : tr("ระบบ"));
  return (
    <div className={cn("flex gap-3", className)} data-shot="audit-entry">
      <CustomerAvatar name={who} colorKey={entry.userId ?? "system"} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold">{who}</span>
          <span className={cn(entry.action === "void" || entry.action === "delete" || entry.action === "login_failed" ? "text-destructive" : "text-foreground")}>{auditTitle(entry)}</span>
          {showSubject && entry.entityLabel ? (
            href ? (
              <Link href={href} className="font-medium text-primary hover:underline">
                {entry.entityLabel}
              </Link>
            ) : (
              <span className="font-medium">{entry.entityLabel}</span>
            )
          ) : null}
          <span className="num ml-auto shrink-0 text-xs text-muted-foreground">{tr("{0} น.", formatDateTime(entry.at))}</span>
        </div>
        <AuditChanges entry={entry} />
        {entry.note ? <p className="mt-1 text-sm text-muted-foreground">{tr("หมายเหตุ: {0}", entry.note)}</p> : null}
      </div>
    </div>
  );
}
