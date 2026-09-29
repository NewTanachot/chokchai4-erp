"use client";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Crown, LogIn } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { USER_ROLE_LABELS, type AuthStatus, type LoginTile } from "@shared/contract";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { AUTH_QUERY_KEY } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AuthBrand, AuthShell } from "./auth-shell";
import { RecoverDialog } from "./recover-dialog";

const LAST_USER_KEY = "erp:last-user";

function readLastUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

/** Pick your name, type your password / PIN (users without a password are logged in by the tap). */
export function LoginScreen({ status }: { status: AuthStatus }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<LoginTile | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Tile being logged in without a password. */
  const [tapping, setTapping] = useState<string | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Preselect the last user of this computer (or the only one) - only someone who types a password: a user
  // without one would be logged straight back in after logging out.
  useEffect(() => {
    const last = readLastUser();
    const pick = status.users.find((u) => u.id === last) ?? (status.users.length === 1 ? status.users[0] : null);
    if (pick?.hasPassword) setSelected(pick);
  }, [status.users]);

  useEffect(() => {
    if (selected) requestAnimationFrame(() => passwordRef.current?.focus());
  }, [selected]);

  const enter = async (u: LoginTile, pw: string) => {
    await api.auth.login({ userId: u.id, password: pw });
    try {
      localStorage.setItem(LAST_USER_KEY, u.id);
    } catch {
      /* storage unavailable */
    }
    // Nothing cached for the previous user may be shown to this one.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
  };

  const choose = async (u: LoginTile) => {
    setError(null);
    if (u.hasPassword) {
      setSelected(u);
      setPassword("");
      return;
    }
    if (tapping) return;
    setTapping(u.id);
    try {
      await enter(u, "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTapping(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enter(selected, password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-2xl">
        <AuthBrand shopName={status.shopName} subtitle={selected ? tr("ใส่รหัสผ่านเพื่อเข้าสู่ระบบ") : tr("เลือกชื่อของคุณเพื่อเข้าสู่ระบบ")} />
        <Card className="gap-0 overflow-hidden py-0" data-shot="login-card">
          {!selected ? (
            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3" role="list" aria-label={tr("ผู้ใช้งาน")}>
                {status.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="listitem"
                    onClick={() => void choose(u)}
                    disabled={!!tapping}
                    className="flex min-h-20 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors outline-none hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                    data-shot="login-tile"
                  >
                    {tapping === u.id ? (
                      <span className="flex size-10 shrink-0 items-center justify-center">
                        <Spinner className="size-5" />
                      </span>
                    ) : (
                      <CustomerAvatar name={u.name} colorKey={u.id} size="md" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{u.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {u.role === "owner" ? <Crown className="size-3" /> : null}
                        {USER_ROLE_LABELS[u.role]}
                      </span>
                      {u.hasPassword ? null : <span className="block text-xs text-primary">{tr("แตะเพื่อเข้าใช้ ไม่ต้องใส่รหัส")}</span>}
                    </span>
                  </button>
                ))}
              </div>
              {error ? (
                <p role="alert" className="mt-3 text-center text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mx-auto w-full max-w-sm space-y-4 px-6 py-7">
              <div className="flex flex-col items-center gap-2 text-center">
                <CustomerAvatar name={selected.name} colorKey={selected.id} size="lg" />
                <div>
                  <div className="text-lg font-semibold">{selected.name}</div>
                  <div className="text-sm text-muted-foreground">{USER_ROLE_LABELS[selected.role]}</div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-sm font-medium">
                  {tr("รหัสผ่าน / PIN")}
                </label>
                <Input
                  id="login-password"
                  ref={passwordRef}
                  type="password"
                  className={cn("h-12 text-center text-2xl tracking-[0.3em]", error && "border-destructive")}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={!!error || undefined}
                  autoComplete="off"
                  data-shot="login-password"
                />
                {error ? (
                  <p role="alert" className="text-center text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={!password || busy} data-shot="login-submit">
                {busy ? <Spinner /> : <LogIn />} {tr("เข้าสู่ระบบ")}
              </Button>
              <div className="flex items-center justify-between gap-2 text-sm">
                {status.users.length > 1 ? (
                  <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>
                    <ArrowLeft className="size-4" /> {tr("เปลี่ยนผู้ใช้")}
                  </button>
                ) : (
                  <span />
                )}
                {selected.role === "owner" ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => setRecoverOpen(true)}>
                    {tr("ลืมรหัสผ่าน?")}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">{tr("ลืมรหัสผ่าน? ให้เจ้าของร้านตั้งให้ใหม่")}</span>
                )}
              </div>
            </form>
          )}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3">
            <span className="text-sm text-muted-foreground">{tr("พนักงานลงเวลาเข้า-ออกงานได้โดยไม่ต้องเข้าสู่ระบบ")}</span>
            <Button asChild variant="outline" size="lg" className="shrink-0">
              <Link href="/clock/" data-shot="login-clock">
                <Clock /> {tr("ลงเวลาทำงาน")}
              </Link>
            </Button>
          </div>
        </Card>
      </div>
      {selected?.role === "owner" ? <RecoverDialog owner={selected} open={recoverOpen} onOpenChange={setRecoverOpen} /> : null}
    </AuthShell>
  );
}
