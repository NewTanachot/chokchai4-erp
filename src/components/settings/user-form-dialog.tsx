"use client";
import { useQuery } from "@tanstack/react-query";
import { Crown, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_STAFF_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_INFO,
  type Permission,
  type User,
  type UserRole,
} from "@shared/contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { tr, trc } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

const NO_EMPLOYEE = "__none__";

const ROLES: { value: UserRole; title: string; hint: string; icon: typeof Crown }[] = [
  { value: "staff", title: trc("role", "พนักงาน"), hint: tr("ขายสินค้า ดูบิล และทำได้ตามสิทธิ์ที่เลือกด้านล่าง"), icon: UserRound },
  { value: "owner", title: trc("role", "เจ้าของร้าน"), hint: tr("ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้และดูเงินเดือน"), icon: Crown },
];

/** Create / edit a program user. Password is set on create; later via "ตั้งรหัสผ่านใหม่". */
export function UserFormDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: User | null }) {
  const { user: me } = useAuth();
  const isEdit = !!user;
  const self = user?.id === me.id;
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_STAFF_PERMISSIONS);
  const [employeeId, setEmployeeId] = useState<string>(NO_EMPLOYEE);
  const [isActive, setIsActive] = useState(true);
  const [usePassword, setUsePassword] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsePassword(true);
    setName(user?.name ?? "");
    setRole(user?.role ?? "staff");
    setPermissions(user && user.role === "staff" ? user.permissions : DEFAULT_STAFF_PERMISSIONS);
    setEmployeeId(user?.employeeId ?? NO_EMPLOYEE);
    setIsActive(user?.isActive ?? true);
    setPassword("");
    setConfirm("");
    setError(null);
  }, [open, user]);

  const employees = useQuery({ queryKey: ["employees", "list", { status: "all", limit: 500 }], queryFn: () => api.employees.list({ status: "all", limit: 500 }), enabled: open });

  const save = useApiMutation(
    () => {
      const base = { name, role, permissions, employeeId: employeeId === NO_EMPLOYEE ? null : employeeId, isActive };
      return isEdit ? api.users.update({ ...base, id: user!.id }) : api.users.create({ ...base, password: usePassword ? password : null });
    },
    {
      successMessage: (u) => (isEdit ? tr("บันทึกผู้ใช้ “{0}” แล้ว", u.name) : tr("เพิ่มผู้ใช้ “{0}” แล้ว", u.name)),
      toastError: false,
      onSuccess: () => onOpenChange(false),
      onError: (e) => setError(e instanceof ApiClientError ? e.message : errorMessage(e)),
    },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(tr("กรุณากรอกชื่อผู้ใช้"));
    if (!isEdit && usePassword) {
      if (password.length < 4) return setError(tr("รหัสผ่านต้องมีอย่างน้อย 4 ตัว"));
      if (password !== confirm) return setError(tr("รหัสผ่านทั้งสองช่องไม่ตรงกัน"));
    }
    setError(null);
    save.mutate();
  };

  const toggle = (p: Permission, on: boolean) => setPermissions((list) => (on ? [...new Set([...list, p])] : list.filter((x) => x !== p)));

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl" data-shot="user-form">
        <DialogHeader>
          <DialogTitle className="text-lg">{isEdit ? tr("แก้ไขผู้ใช้ — {0}", user!.name) : tr("เพิ่มผู้ใช้งาน")}</DialogTitle>
          <DialogDescription>{tr("ผู้ใช้เข้าสู่ระบบด้วยชื่อ และรหัสผ่าน/PIN ของตัวเอง (หรือแตะชื่อ ถ้าไม่ใช้รหัสผ่าน) ทุกบิลและการแก้ไขจะบันทึกชื่อผู้ใช้ไว้")}</DialogDescription>
        </DialogHeader>
        <form id="user-form" onSubmit={submit} noValidate className="-mx-4 grid gap-5 overflow-y-auto px-4 pb-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="u-name">
                {tr("ชื่อที่แสดง")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="u-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("เช่น น้องเมย์")} autoComplete="off" autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-employee">{tr("เป็นพนักงานคนไหน")}</FieldLabel>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="u-employee" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_EMPLOYEE}>{tr("ไม่ผูกกับพนักงาน")}</SelectItem>
                  {(employees.data?.items ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id} disabled={!!e.userId && e.userId !== user?.id}>
                      {e.displayName} ({e.fullName}){e.userId && e.userId !== user?.id ? tr(" · มีบัญชีแล้ว") : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription className="text-xs">{tr("ใช้เชื่อมกับข้อมูลพนักงาน (ไม่บังคับ)")}</FieldDescription>
            </Field>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">{tr("ระดับผู้ใช้")}</div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tr("ระดับผู้ใช้")}>
              {ROLES.map((r) => {
                const active = role === r.value;
                const Icon = r.icon;
                return (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={self}
                    onClick={() => setRole(r.value)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60",
                      active && "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                    )}
                  >
                    <Icon className={cn("mt-0.5 size-5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span>
                      <span className="block font-medium">{r.title}</span>
                      <span className="block text-xs leading-relaxed text-muted-foreground">{r.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {self ? <p className="mt-1.5 text-xs text-muted-foreground">{tr("เปลี่ยนระดับหรือปิดใช้งานบัญชีของตัวเองไม่ได้")}</p> : null}
          </div>

          {role === "staff" ? (
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{tr("สิทธิ์ของพนักงานคนนี้")}</span>
                <span className="text-xs text-muted-foreground">{tr("ทุกคนขายสินค้า ดูบิล เพิ่มลูกค้า และรับชำระบิลขายได้")}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {PERMISSION_GROUPS.map((g) => (
                  <fieldset key={g.label} className="rounded-lg border p-3">
                    <legend className="px-1 text-xs font-medium text-muted-foreground">{g.label}</legend>
                    <div className="space-y-2.5">
                      {g.items.map((p) => (
                        <label key={p} className="flex cursor-pointer items-start gap-2.5">
                          <Checkbox checked={permissions.includes(p)} onCheckedChange={(v) => toggle(p, v === true)} className="mt-0.5 size-4.5" data-shot={`perm-${p}`} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium leading-snug">{PERMISSION_INFO[p].label}</span>
                            <span className="block text-xs leading-relaxed text-muted-foreground">{PERMISSION_INFO[p].hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          ) : null}

          {!isEdit ? (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50">
                <Switch checked={usePassword} onCheckedChange={setUsePassword} className="mt-0.5" data-shot="user-use-password" />
                <span>
                  <span className="block text-sm font-medium">{tr("ใช้รหัสผ่าน / PIN")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {usePassword ? tr("ต้องใส่รหัสทุกครั้งที่เข้าสู่ระบบ") : tr("ไม่ต้องใส่รหัส — แตะชื่อที่หน้าเข้าสู่ระบบก็เข้าใช้ได้เลย")}
                  </span>
                </span>
              </label>
              {usePassword ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="u-pass">
                      {tr("รหัสผ่าน / PIN")} <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input id="u-pass" type="password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <FieldDescription className="text-xs">{tr("อย่างน้อย 4 ตัว แจ้งให้พนักงานทราบ แล้วให้เปลี่ยนเองภายหลังได้")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="u-confirm">
                      {tr("ยืนยันรหัสผ่าน")} <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input id="u-confirm" type="password" className="h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  </Field>
                </div>
              ) : role === "owner" ? (
                <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                  {tr("บัญชีเจ้าของร้านทำได้ทุกอย่าง ถ้าไม่ใช้รหัสผ่าน ใครที่ใช้เครื่องนี้ก็เข้าบัญชีนี้ได้")}
                </p>
              ) : null}
            </div>
          ) : (
            <label className={cn("flex items-start gap-3 rounded-lg border p-3", self ? "opacity-60" : "cursor-pointer hover:bg-muted/50")}>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={self} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">{tr("เปิดใช้งาน")}</span>
                <span className="block text-xs text-muted-foreground">{tr("ปิดเมื่อพนักงานลาออก — ประวัติและบิลเดิมยังแสดงชื่อนี้อยู่")}</span>
              </span>
            </label>
          )}

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tr("ยกเลิก")}
          </Button>
          <Button type="submit" form="user-form" size="lg" className="min-w-24" disabled={save.isPending} data-shot="user-save">
            {save.isPending ? <Spinner /> : null}
            {isEdit ? tr("บันทึก") : tr("เพิ่มผู้ใช้")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Owner: set a new password for a user (forgotten password), or remove it (log in by tapping the name). */
export function ResetPasswordDialog({ user, onOpenChange }: { user: User | null; onOpenChange: (o: boolean) => void }) {
  const [usePassword, setUsePassword] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUsePassword(true);
    setPassword("");
    setError(null);
  }, [user]);
  const save = useApiMutation(() => api.users.resetPassword({ id: user!.id, password: usePassword ? password : null }), {
    successMessage: () => (usePassword ? tr("ตั้งรหัสผ่านใหม่ให้ “{0}” แล้ว", user?.name ?? "") : tr("“{0}” เข้าใช้ได้โดยไม่ต้องใส่รหัสผ่านแล้ว", user?.name ?? "")),
    toastError: false,
    onSuccess: () => onOpenChange(false),
    onError: (e) => setError(e.message),
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (usePassword && password.length < 4) return setError(tr("รหัสผ่านต้องมีอย่างน้อย 4 ตัว"));
            save.mutate();
          }}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{tr("รหัสผ่าน — {0}", user?.name)}</DialogTitle>
            <DialogDescription>
              {tr("{0} — ถ้าพนักงานลืมรหัส ตั้งรหัสใหม่ให้ได้ที่นี่", user?.hasPassword ? tr("ตอนนี้ใช้รหัสผ่านเข้าสู่ระบบ") : tr("ตอนนี้เข้าใช้ด้วยการแตะชื่อ (ไม่ใช้รหัสผ่าน)"))}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2" role="radiogroup" aria-label={tr("วิธีเข้าสู่ระบบ")}>
            {[
              { value: true, title: tr("ตั้งรหัสผ่านใหม่"), hint: tr("แจ้งรหัสใหม่ให้พนักงาน แล้วให้เปลี่ยนเองได้ที่เมนูชื่อผู้ใช้") },
              { value: false, title: tr("ไม่ใช้รหัสผ่าน"), hint: tr("แตะชื่อที่หน้าเข้าสู่ระบบก็เข้าใช้ได้เลย") },
            ].map((o) => (
              <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={usePassword === o.value}
                onClick={() => {
                  setUsePassword(o.value);
                  setError(null);
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors hover:bg-muted/40",
                  usePassword === o.value && "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                )}
                data-shot={o.value ? "reset-password-set" : "reset-password-none"}
              >
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </button>
            ))}
          </div>
          {usePassword ? (
            <Field>
              <FieldLabel htmlFor="rp-pass">{tr("รหัสผ่านใหม่ / PIN")}</FieldLabel>
              <Input id="rp-pass" type="password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
          ) : user?.role === "owner" ? (
            <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
              {tr("บัญชีเจ้าของร้านทำได้ทุกอย่าง ถ้าไม่ใช้รหัสผ่าน ใครที่ใช้เครื่องนี้ก็เข้าบัญชีนี้ได้")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tr("ยกเลิก")}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending || (usePassword && !password)} data-shot="reset-password-save">
              {save.isPending ? <Spinner /> : null} {tr("บันทึก")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
