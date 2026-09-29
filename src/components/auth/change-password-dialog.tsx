"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { AUTH_QUERY_KEY } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";

/** Change your own password, or set one when you log in without a password (`hasPassword` false). */
export function ChangePasswordDialog({ open, onOpenChange, hasPassword }: { open: boolean; onOpenChange: (o: boolean) => void; hasPassword: boolean }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const save = useApiMutation(() => api.auth.changePassword({ currentPassword: hasPassword ? current : "", newPassword: next }), {
    successMessage: hasPassword ? tr("เปลี่ยนรหัสผ่านแล้ว") : tr("ตั้งรหัสผ่านแล้ว ครั้งต่อไปต้องใส่รหัสนี้เพื่อเข้าสู่ระบบ"),
    toastError: false,
    onSuccess: () => {
      onOpenChange(false);
      // The user menu shows "เปลี่ยนรหัสผ่าน" from now on.
      void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 4) return setError(tr("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัว"));
    if (next !== confirm) return setError(tr("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"));
    setError(null);
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{hasPassword ? tr("เปลี่ยนรหัสผ่าน") : tr("ตั้งรหัสผ่าน")}</DialogTitle>
            <DialogDescription>
              {hasPassword ? tr("รหัสผ่านหรือ PIN ที่ใช้เข้าสู่ระบบของคุณ") : tr("ตอนนี้คุณเข้าใช้ด้วยการแตะชื่อ ตั้งรหัสผ่านแล้วต้องใส่รหัสทุกครั้งที่เข้าสู่ระบบ")}
            </DialogDescription>
          </DialogHeader>
          {hasPassword ? (
            <Field>
              <FieldLabel htmlFor="cp-current">{tr("รหัสผ่านปัจจุบัน")}</FieldLabel>
              <Input id="cp-current" type="password" className="h-10" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="cp-new">{tr("รหัสผ่านใหม่")}</FieldLabel>
            <Input id="cp-new" type="password" className="h-10" value={next} onChange={(e) => setNext(e.target.value)} autoFocus={!hasPassword} />
            <FieldDescription className="text-xs">{tr("อย่างน้อย 4 ตัว")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="cp-confirm">{tr("ยืนยันรหัสผ่านใหม่")}</FieldLabel>
            <Input id="cp-confirm" type="password" className="h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tr("ยกเลิก")}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending || (hasPassword && !current) || !next}>
              {save.isPending ? <Spinner /> : null} {tr("บันทึก")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
