"use client";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { AUTH_QUERY_KEY } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { AuthBrand, AuthShell } from "./auth-shell";
import { RecoveryCodePanel } from "./recovery-code";

/** First start: create the owner account. */
export function SetupScreen({ shopName }: { shopName: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(tr("เจ้าของร้าน"));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [noPassword, setNoPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const mismatch = !noPassword && confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!noPassword) {
      if (password.length < 4) return setError(tr("รหัสผ่านต้องมีอย่างน้อย 4 ตัว"));
      if (password !== confirm) return setError(tr("รหัสผ่านทั้งสองช่องไม่ตรงกัน"));
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.setupOwner({ name, password: noPassword ? null : password });
      // Without a password there is no recovery code to keep: straight into the program.
      if (r.recoveryCode) setCode(r.recoveryCode);
      else await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <AuthBrand shopName={shopName} subtitle={tr("ระบบจัดการร้าน ยาง · ช่วงล่าง · แบตเตอรี่")} />
        <Card className="gap-5 px-6 py-6" data-shot="setup-card">
          {code ? (
            <>
              <div>
                <h2 className="text-lg font-semibold">{tr("สร้างบัญชีเจ้าของร้านแล้ว")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{tr("ขั้นสุดท้าย: เก็บรหัสกู้คืนไว้ให้ดี")}</p>
              </div>
              <RecoveryCodePanel code={code} doneText={tr("เริ่มใช้งานโปรแกรม")} onDone={() => void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY })} />
            </>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold">{tr("ตั้งค่าบัญชีเจ้าของร้าน")}</h2>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {tr("ทุกบิลและการแก้ไขจะบันทึกว่าใครเป็นคนทำ เริ่มจากสร้างบัญชีของเจ้าของร้าน แล้วค่อยเพิ่มพนักงานที่หน้าตั้งค่า")}
                  </p>
                </div>
              </div>
              <Field>
                <FieldLabel htmlFor="setup-name">{tr("ชื่อที่แสดง")}</FieldLabel>
                <Input id="setup-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </Field>
              {noPassword ? null : (
                <>
                  <Field>
                    <FieldLabel htmlFor="setup-password">{tr("รหัสผ่าน หรือ PIN")}</FieldLabel>
                    <Input id="setup-password" className="h-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus data-shot="setup-password" />
                    <FieldDescription className="text-xs">{tr("อย่างน้อย 4 ตัว เช่น ตัวเลข 4–6 หลักที่จำง่าย")}</FieldDescription>
                  </Field>
                  <Field data-invalid={mismatch || undefined}>
                    <FieldLabel htmlFor="setup-confirm">{tr("ยืนยันรหัสผ่าน")}</FieldLabel>
                    <Input id="setup-confirm" className="h-10" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />
                    {mismatch ? <FieldError>{tr("รหัสผ่านไม่ตรงกัน")}</FieldError> : null}
                  </Field>
                </>
              )}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 hover:bg-muted/40">
                <Checkbox checked={noPassword} onCheckedChange={(v) => setNoPassword(v === true)} className="mt-0.5 size-4.5" data-shot="setup-no-password" />
                <span>
                  <span className="block text-sm font-medium">{tr("ไม่ใช้รหัสผ่าน")}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {tr("เข้าใช้ด้วยการแตะชื่อ ไม่ต้องใส่รหัส — ใครที่ใช้เครื่องนี้ก็เข้าบัญชีเจ้าของร้านได้ ตั้งรหัสผ่านภายหลังได้ที่เมนูชื่อผู้ใช้")}
                  </span>
                </span>
              </label>
              {error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={busy || !name.trim() || (!noPassword && !password)} data-shot="setup-submit">
                {busy ? <Spinner /> : null} {tr("สร้างบัญชีเจ้าของร้าน")}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </AuthShell>
  );
}
