"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LoginTile } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { AUTH_QUERY_KEY } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { RecoveryCodePanel } from "./recovery-code";

/** "ลืมรหัสผ่าน" for an owner: recovery code + new password, then the NEW recovery code is shown once. */
export function RecoverDialog({ owner, open, onOpenChange }: { owner: LoginTile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [recoveryCode, setRecoveryCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRecoveryCode("");
      setPassword("");
      setConfirm("");
      setError(null);
      setNewCode(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 4) return setError(tr("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัว"));
    if (password !== confirm) return setError(tr("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"));
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.recover({ userId: owner.id, recoveryCode, newPassword: password });
      setNewCode(r.recoveryCode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onOpenChange(false);
    void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !newCode && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!newCode}>
        <DialogHeader>
          <DialogTitle>{newCode ? tr("ตั้งรหัสผ่านใหม่แล้ว") : tr("ลืมรหัสผ่าน — {0}", owner.name)}</DialogTitle>
          <DialogDescription>
            {newCode ? tr("รหัสกู้คืนเดิมใช้ไม่ได้แล้ว กรุณาจดรหัสกู้คืนใหม่นี้เก็บไว้") : tr("ใช้รหัสกู้คืนที่ได้ตอนสร้างบัญชีเจ้าของร้าน (หรือครั้งล่าสุดที่ออกรหัสใหม่)")}
          </DialogDescription>
        </DialogHeader>
        {newCode ? (
          <RecoveryCodePanel code={newCode} doneText={tr("เข้าสู่โปรแกรม")} onDone={finish} />
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="rc-code">{tr("รหัสกู้คืน")}</FieldLabel>
              <Input
                id="rc-code"
                className="h-10 font-mono tracking-widest uppercase"
                placeholder="XXXX-XXXX-XXXX"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rc-pass">{tr("รหัสผ่านใหม่")}</FieldLabel>
              <Input id="rc-pass" type="password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
              <FieldDescription className="text-xs">{tr("อย่างน้อย 4 ตัว")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="rc-confirm">{tr("ยืนยันรหัสผ่านใหม่")}</FieldLabel>
              <Input id="rc-confirm" type="password" className="h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {error ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
                {tr("ยกเลิก")}
              </Button>
              <Button type="submit" size="lg" disabled={busy || !recoveryCode.trim() || !password}>
                {busy ? <Spinner /> : null} {tr("ตั้งรหัสผ่านใหม่")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
