"use client";
import { useQuery } from "@tanstack/react-query";
import { Crown, KeyRound, Lock, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { PERMISSION_INFO, PERMISSIONS, type AppSettings, type User } from "@shared/contract";
import { RecoveryCodePanel } from "@/components/auth/recovery-code";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { tr, trc } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { FormField, SectionCard } from "./section-card";
import { ResetPasswordDialog, UserFormDialog } from "./user-form-dialog";
import { useSectionForm } from "./use-section-form";

const LOCK_OPTIONS = [0, 5, 10, 15, 30, 60];

export function UsersSection({ security }: { security: AppSettings["security"] }) {
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ["users", "list"], queryFn: () => api.users.list() });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const remove = useApiMutation((id: string) => api.users.remove(id), { successMessage: tr("ลบผู้ใช้แล้ว"), onSettled: () => setDeleting(null) });

  const open = (u: User | null) => {
    setEditing(u);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <SectionCard
        icon={Users}
        title={tr("ผู้ใช้งานโปรแกรม")}
        description={tr("เพิ่มบัญชีให้พนักงานที่ใช้โปรแกรม และเลือกว่าแต่ละคนทำอะไรได้บ้าง")}
        action={
          <Button size="lg" onClick={() => open(null)} data-shot="new-user">
            <Plus /> {tr("เพิ่มผู้ใช้")}
          </Button>
        }
        contentClassName="px-0 py-0"
      >
        {users.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : users.isError ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(users.error)}</p>
        ) : (
          <ul className="divide-y" data-shot="user-list">
            {users.data.map((u) => {
              const all = u.role === "owner" || u.permissions.length === PERMISSIONS.length;
              return (
                <li key={u.id} className={cn("flex items-center gap-3 px-4 py-3", !u.isActive && "opacity-60")}>
                  <CustomerAvatar name={u.name} colorKey={u.id} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{u.name}</span>
                      {u.role === "owner" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Crown /> {tr("เจ้าของร้าน")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{trc("role", "พนักงาน")}</Badge>
                      )}
                      {u.id === me.id ? <Badge variant="outline">{tr("คุณ")}</Badge> : null}
                      {u.hasPassword ? null : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {tr("ไม่ใช้รหัสผ่าน")}
                        </Badge>
                      )}
                      {!u.isActive ? <Badge variant="outline" className="text-muted-foreground">{tr("ปิดใช้งาน")}</Badge> : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {all ? tr("ทำได้ทุกอย่าง") : u.permissions.length ? u.permissions.map((p) => PERMISSION_INFO[p].label).join(" · ") : tr("ขายสินค้าและดูบิลเท่านั้น")}
                    </div>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    {u.employeeName ? <div>{tr("พนักงาน: {0}", u.employeeName)}</div> : null}
                    <div>{u.lastLoginAt ? tr("เข้าใช้ล่าสุด {0}", formatRelative(u.lastLoginAt)) : tr("ยังไม่เคยเข้าใช้")}</div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={tr("จัดการ {0}", u.name)}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuItem onSelect={() => open(u)}>
                        <Pencil /> {tr("แก้ไขชื่อ / สิทธิ์")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setResetting(u)}>
                        <KeyRound /> {u.hasPassword ? tr("ตั้งรหัสผ่านใหม่ / ไม่ใช้รหัส") : tr("ตั้งรหัสผ่าน")}
                      </DropdownMenuItem>
                      {u.id !== me.id ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(u)}>
                            <Trash2 /> {tr("ลบผู้ใช้")}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <AutoLockCard saved={security} />
      <RecoveryCard />

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />
      <ResetPasswordDialog user={resetting} onOpenChange={(o) => !o && setResetting(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={tr("ลบผู้ใช้ “{0}”?", deleting?.name ?? "")}
        description={tr("ผู้ใช้นี้จะเข้าสู่ระบบไม่ได้อีก บิลและประวัติที่เคยทำไว้ยังแสดงชื่อนี้เหมือนเดิม")}
        confirmText={tr("ลบผู้ใช้")}
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function AutoLockCard({ saved }: { saved: AppSettings["security"] }) {
  const f = useSectionForm("security", saved, { id: "users", successMessage: tr("บันทึกการล็อกหน้าจอแล้ว") });
  return (
    <SectionCard icon={Lock} title={tr("ล็อกหน้าจออัตโนมัติ")} description={tr("ออกจากระบบเองเมื่อไม่มีใครใช้งานเครื่องสักพัก กันคนอื่นใช้ชื่อของคุณเปิดบิล")} form={f} shot="security">
      <FormField label={tr("ออกจากระบบเมื่อไม่ได้ใช้งาน")} htmlFor="auto-lock" hint={tr("ถ้ากำลังเปิดบิลที่ยังไม่บันทึก ระบบจะยังไม่ล็อก")}>
        <Select value={String(f.value.autoLockMinutes)} onValueChange={(v) => f.set("autoLockMinutes", Number(v))}>
          <SelectTrigger id="auto-lock" className="h-10 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([...LOCK_OPTIONS, f.value.autoLockMinutes])]
              .sort((a, b) => a - b)
              .map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m === 0 ? tr("ไม่ล็อกอัตโนมัติ") : tr("หลังจาก {0} นาที", m)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FormField>
    </SectionCard>
  );
}

function RecoveryCard() {
  const [confirm, setConfirm] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const issue = useApiMutation(() => api.auth.newRecoveryCode(), { onSuccess: (r) => setCode(r.recoveryCode) });
  return (
    <SectionCard icon={ShieldCheck} title={tr("รหัสกู้คืนของเจ้าของร้าน")} description={tr("ใช้ตั้งรหัสผ่านใหม่เมื่อเจ้าของร้านลืมรหัสผ่าน (กด “ลืมรหัสผ่าน?” ที่หน้าเข้าสู่ระบบ)")}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
          {tr("ถ้าทำรหัสกู้คืนหาย ให้ออกรหัสใหม่แล้วจดเก็บไว้ รหัสเดิมจะใช้ไม่ได้ทันที")}
        </p>
        <Button variant="outline" size="lg" onClick={() => setConfirm(true)} disabled={issue.isPending}>
          {issue.isPending ? <Spinner /> : <KeyRound />} {tr("ออกรหัสกู้คืนใหม่")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={tr("ออกรหัสกู้คืนใหม่?")}
        description={tr("รหัสกู้คืนเดิมจะใช้ไม่ได้อีก กรุณาเตรียมจดรหัสใหม่ที่จะแสดงในหน้าถัดไป")}
        confirmText={tr("ออกรหัสใหม่")}
        onConfirm={() => issue.mutate()}
      />
      <Dialog open={!!code} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{tr("รหัสกู้คืนใหม่")}</DialogTitle>
            <DialogDescription>{tr("จดเก็บไว้ในที่ปลอดภัย ระบบจะแสดงรหัสนี้ครั้งเดียว")}</DialogDescription>
          </DialogHeader>
          {code ? <RecoveryCodePanel code={code} doneText={tr("เสร็จสิ้น")} onDone={() => setCode(null)} /> : null}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
