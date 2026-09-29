"use client";
import {
  ArchiveRestore,
  Clock,
  Copy,
  DatabaseBackup,
  FolderOpen,
  HardDriveDownload,
  History,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { AppSettings, BackupFile } from "@shared/contract";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { formatBytes } from "./logo-image";
import { FormField, SectionCard, StepperInput, SwitchRow } from "./section-card";
import { useSectionForm, type FieldErrors } from "./use-section-form";

type Backup = AppSettings["backup"];
type RestoreTarget = { kind: "list"; file: BackupFile } | { kind: "file" };

const STALE_MS = 2 * 86_400_000;

function validate(v: Backup): FieldErrors<Backup> {
  if (!Number.isInteger(v.keepDays) || v.keepDays < 1 || v.keepDays > 365) return { keepDays: tr("เก็บได้ 1–365 วัน") };
  return {};
}

function kindOf(name: string): { label: string; variant: "secondary" | "outline" } {
  if (/^auto-/i.test(name)) return { label: tr("สำรองอัตโนมัติ"), variant: "secondary" };
  if (/^before-restore-/i.test(name)) return { label: tr("สำเนาก่อนกู้คืน"), variant: "outline" };
  return { label: tr("สำรองด้วยตนเอง"), variant: "outline" };
}

export function BackupSection({ saved }: { saved: Backup }) {
  // Restoring replaces every record (including users): owners only.
  const { isOwner } = useAuth();
  const info = useQuery({ queryKey: ["system", "info"], queryFn: () => api.system.info(), retry: false });
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreState, setRestoreState] = useState<"idle" | "working" | "restarting">("idle");

  const backupNow = useApiMutation(() => api.system.backup(), {
    onSuccess: (r) => {
      if (r) toast.success(tr("สำรองข้อมูลเรียบร้อยแล้ว"), { description: r.path, duration: 8000 });
    },
  });

  const askRestore = (t: RestoreTarget) => {
    setRestoreTarget(t);
    setConfirmOpen(true);
  };

  const doRestore = async () => {
    const t = restoreTarget;
    if (!t) return;
    setRestoreState("working");
    try {
      const r = await api.system.restore(t.kind === "list" ? { path: t.file.path } : undefined);
      if (r.restored) setRestoreState("restarting");
      else setRestoreState("idle"); // file dialog cancelled
    } catch (e) {
      setRestoreState("idle");
      toast.error(errorMessage(e), { duration: 10_000 });
    }
  };

  const last = info.data?.lastAutoBackupAt ?? null;

  return (
    <div className="space-y-6">
      <BackupStatus
        autoBackup={saved.autoBackup}
        last={last}
        loading={info.isPending}
        onBackup={() => backupNow.mutate()}
        backingUp={backupNow.isPending}
      />
      <AutoBackupForm saved={saved} />
      <BackupList onRestore={isOwner ? (file) => askRestore({ kind: "list", file }) : null} disabled={restoreState !== "idle"} />

      <SectionCard
        icon={ArchiveRestore}
        title={tr("กู้คืนข้อมูลจากไฟล์")}
        description={tr("ใช้เมื่อย้ายเครื่องใหม่ หรือต้องการย้อนข้อมูลกลับไปเป็นของวันที่สำรองไว้")}
        className={isOwner ? undefined : "hidden"}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            {tr("เลือกไฟล์สำรองข้อมูล (.db) ที่เคยบันทึกไว้ เช่น จากแฟลชไดรฟ์ ข้อมูลปัจจุบันจะถูกแทนที่ และระบบจะเก็บสำเนาข้อมูลปัจจุบันไว้ให้ก่อนเสมอ")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => askRestore({ kind: "file" })}
            disabled={restoreState !== "idle"}
            data-shot="restore-file"
          >
            <RotateCcw /> {tr("กู้คืนจากไฟล์…")}
          </Button>
        </div>
      </SectionCard>

      <DataLocation info={info.data ?? null} loading={info.isPending} error={info.isError ? errorMessage(info.error) : null} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title={tr("กู้คืนข้อมูลจากไฟล์สำรอง?")}
        description={
          restoreTarget?.kind === "list" ? (
            <>
              {tr("ข้อมูลในโปรแกรมจะย้อนกลับไปเป็นของวันที่ ")}
              <strong className="font-semibold text-foreground">{formatDateTime(restoreTarget.file.createdAt)}</strong>
            </>
          ) : (
            tr("ขั้นตอนถัดไปจะให้เลือกไฟล์สำรองข้อมูล (.db) ที่ต้องการกู้คืน")
          )
        }
        confirmText={restoreTarget?.kind === "list" ? tr("กู้คืนและเริ่มโปรแกรมใหม่") : tr("เลือกไฟล์และกู้คืน")}
        onConfirm={doRestore}
      >
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5 dark:bg-destructive/10">
          <TriangleAlert />
          <AlertTitle>{tr("ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่")}</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/80">
              <li>{tr("รายการขาย ซื้อ สินค้า และลูกค้าที่บันทึกหลังจากวันที่สำรองไฟล์นี้จะหายไป")}</li>
              <li>{tr("ระบบจะเก็บสำเนาข้อมูลปัจจุบันไว้ให้ก่อน (ชื่อ “สำเนาก่อนกู้คืน”) ถ้าเลือกผิดสามารถกู้กลับได้")}</li>
              <li>{tr("โปรแกรมจะปิดและเปิดใหม่เองโดยอัตโนมัติ")}</li>
            </ul>
          </AlertDescription>
        </Alert>
      </ConfirmDialog>

      <Dialog open={restoreState !== "idle"}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Spinner className="size-8 text-primary" />
            <DialogTitle>{restoreState === "restarting" ? tr("กู้คืนข้อมูลเรียบร้อย") : tr("กำลังกู้คืนข้อมูล…")}</DialogTitle>
            <DialogDescription>
              {restoreState === "restarting"
                ? tr("กำลังเริ่มโปรแกรมใหม่ กรุณารอสักครู่")
                : tr("กรุณาอย่าปิดโปรแกรม ถ้ามีหน้าต่างเลือกไฟล์ ให้เลือกไฟล์สำรองข้อมูลที่ต้องการ")}
            </DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackupStatus({
  autoBackup,
  last,
  loading,
  onBackup,
  backingUp,
}: {
  autoBackup: boolean;
  last: number | null;
  loading: boolean;
  onBackup: () => void;
  backingUp: boolean;
}) {
  const fresh = last !== null && Date.now() - last < STALE_MS;
  const good = autoBackup && fresh;
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl",
            good ? "bg-success/15 text-success" : "bg-warning/20 text-warning-foreground dark:text-warning",
          )}
        >
          {good ? <ShieldCheck className="size-6" /> : <ShieldAlert className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">
            {good ? tr("ข้อมูลได้รับการสำรองแล้ว") : autoBackup ? tr("ยังไม่มีการสำรองข้อมูลล่าสุด") : tr("ปิดการสำรองข้อมูลอัตโนมัติอยู่")}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            {loading ? (
              <Skeleton className="h-4 w-40" />
            ) : last !== null ? (
              <span>
                {tr("สำรองอัตโนมัติล่าสุด")} <span className="font-medium text-foreground">{formatRelative(last)}</span> ({formatDateTime(last)})
              </span>
            ) : (
              <span>{tr("ยังไม่เคยสำรองข้อมูลอัตโนมัติ")}</span>
            )}
          </div>
        </div>
        <Button type="button" size="lg" className="h-10 px-4" onClick={onBackup} disabled={backingUp} data-shot="backup-now">
          {backingUp ? <Spinner /> : <HardDriveDownload />} {tr("สำรองข้อมูลตอนนี้")}
        </Button>
      </div>
      <div className="border-t bg-muted/40 px-5 py-3 text-sm leading-relaxed text-muted-foreground">
        {tr("ข้อมูลของร้านเก็บอยู่ในเครื่องนี้เครื่องเดียว — แนะนำให้กด")} <span className="font-medium text-foreground">{tr("สำรองข้อมูลตอนนี้")}</span>{tr(" แล้วเก็บไฟล์ไว้ในแฟลชไดรฟ์หรือ Google Drive อย่างน้อยสัปดาห์ละครั้ง เผื่อเครื่องเสียหรือสูญหาย")}
      </div>
    </Card>
  );
}

function AutoBackupForm({ saved }: { saved: Backup }) {
  const f = useSectionForm("backup", saved, { validate, successMessage: tr("บันทึกการตั้งค่าสำรองข้อมูลแล้ว") });
  const v = f.value;
  return (
    <SectionCard icon={DatabaseBackup} title={tr("สำรองข้อมูลอัตโนมัติ")} description={tr("สำรองไว้ในเครื่องนี้ทุกวัน ตอนเปิดโปรแกรม (ไม่เกินวันละครั้ง)")} form={f} shot="backup">
      <div className="space-y-5">
        <SwitchRow
          title={tr("สำรองข้อมูลอัตโนมัติทุกวัน")}
          description={tr("แนะนำให้เปิดไว้เสมอ ใช้พื้นที่น้อยและไม่รบกวนการทำงาน")}
          checked={v.autoBackup}
          onCheckedChange={(on) => f.set("autoBackup", on)}
          shot="auto-backup"
        />
        <FormField
          label={tr("เก็บไฟล์สำรองอัตโนมัติย้อนหลัง")}
          htmlFor="backup-keepDays"
          error={f.errorOf("keepDays")}
          hint={tr("ไฟล์ที่เก่ากว่านี้จะถูกลบเอง (เก็บไว้อย่างน้อย 3 ไฟล์ล่าสุดเสมอ)")}
        >
          <StepperInput
            id="backup-keepDays"
            value={v.keepDays}
            min={1}
            max={365}
            suffix={tr("วัน")}
            disabled={!v.autoBackup}
            invalid={!!f.errorOf("keepDays")}
            onChange={(n) => f.set("keepDays", n)}
          />
        </FormField>
      </div>
    </SectionCard>
  );
}

/** `onRestore` null = the user may not restore (no restore buttons). */
function BackupList({ onRestore, disabled }: { onRestore: ((f: BackupFile) => void) | null; disabled: boolean }) {
  const q = useQuery({ queryKey: ["system", "listBackups"], queryFn: () => api.system.listBackups(), retry: false });
  const [showAll, setShowAll] = useState(false);
  const files = q.data ?? [];
  const shown = showAll ? files : files.slice(0, 6);

  return (
    <SectionCard
      icon={History}
      title={tr("ไฟล์สำรองในเครื่องนี้")}
      description={tr("ไฟล์สำรองอัตโนมัติ และสำเนาที่เก็บไว้ก่อนการกู้คืนแต่ละครั้ง")}
      contentClassName="px-0 py-0"
      action={files.length ? <Badge variant="secondary" className="num">{tr("{0} ไฟล์", files.length)}</Badge> : null}
    >
      {q.isPending ? (
        <div className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="p-4">
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{tr("โหลดรายการไฟล์สำรองไม่ได้")}</AlertTitle>
            <AlertDescription>{errorMessage(q.error)}</AlertDescription>
          </Alert>
        </div>
      ) : files.length === 0 ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseBackup />
            </EmptyMedia>
            <EmptyTitle>{tr("ยังไม่มีไฟล์สำรองในเครื่องนี้")}</EmptyTitle>
            <EmptyDescription>{tr("เมื่อเปิดการสำรองอัตโนมัติ ระบบจะสำรองให้ครั้งแรกในการเปิดโปรแกรมครั้งถัดไป")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ul className="divide-y">
            {shown.map((file) => {
              const kind = kindOf(file.name);
              return (
                <li key={file.path} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-sm font-medium">{formatDateTime(file.createdAt)}</span>
                      <span className="text-xs text-muted-foreground">· {formatRelative(file.createdAt)}</span>
                      <Badge variant={kind.variant}>{kind.label}</Badge>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={file.path}>
                      {file.name} · <span className="num">{formatBytes(file.size)}</span>
                    </div>
                  </div>
                  {onRestore ? (
                    <Button type="button" variant="outline" onClick={() => onRestore(file)} disabled={disabled} data-shot="restore-item">
                      <RotateCcw /> {tr("กู้คืน")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {files.length > 6 ? (
            <div className="border-t px-4 py-2 text-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
                {showAll ? tr("แสดงน้อยลง") : tr("แสดงทั้งหมด ({0} ไฟล์)", files.length)}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-start gap-1.5">
        <code className="min-w-0 flex-1 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs leading-5 break-all">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tr("คัดลอก{0}", label)}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(
              () => toast.success(tr("คัดลอกแล้ว")),
              () => toast.error(tr("คัดลอกไม่สำเร็จ")),
            )
          }
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

export function DataLocation({
  info,
  loading,
  error,
}: {
  info: { dbPath: string; backupsPath: string; userDataPath: string } | null;
  loading: boolean;
  error: string | null;
}) {
  const open = useApiMutation(() => api.system.openDataFolder());
  return (
    <SectionCard
      icon={FolderOpen}
      title={tr("ตำแหน่งเก็บข้อมูล")}
      description={tr("ไฟล์ฐานข้อมูลของร้านบนเครื่องนี้")}
      action={
        <Button type="button" variant="outline" onClick={() => open.mutate()} disabled={open.isPending || !info}>
          <FolderOpen /> {tr("เปิดโฟลเดอร์ข้อมูล")}
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error || !info ? (
        <p className="text-sm text-muted-foreground">{error ?? tr("ไม่พบข้อมูล")}</p>
      ) : (
        <div className="space-y-3">
          <PathRow label={tr("ไฟล์ฐานข้อมูล")} value={info.dbPath} />
          <PathRow label={tr("โฟลเดอร์ไฟล์สำรองอัตโนมัติ")} value={info.backupsPath} />
        </div>
      )}
    </SectionCard>
  );
}
