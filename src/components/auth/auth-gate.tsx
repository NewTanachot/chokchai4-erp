"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage, UNAUTHORIZED_EVENT } from "@/lib/api";
import { AUTH_QUERY_KEY, AuthContext, authValue } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { hasUnsavedWork } from "@/lib/unsaved";
import { AuthShell } from "./auth-shell";
import { LoginScreen } from "./login-screen";
import { SetupScreen } from "./setup-screen";

/**
 * Shows the app only to a logged-in user: first-run setup, else the login screen, else the children with the
 * user in context. Logging out drops every cached query, so the next user never sees the previous one's data.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: AUTH_QUERY_KEY, queryFn: () => api.auth.status(), staleTime: Infinity, refetchOnWindowFocus: false, retry: false });
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  const doLogout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    }
  }, [qc]);

  const logout = useCallback(() => {
    if (hasUnsavedWork()) setConfirmLogout(true);
    else void doLogout();
  }, [doLogout]);

  const user = status.data?.user ?? null;
  const value = useMemo(() => (user ? authValue(user, logout) : null), [user, logout]);

  if (status.isPending) {
    return (
      <AuthShell className="items-center">
        <Spinner className="size-8 text-sidebar-foreground" />
      </AuthShell>
    );
  }
  if (status.isError) {
    return (
      <AuthShell className="items-center">
        <div className="max-w-md rounded-xl bg-card p-6 text-center shadow-lg">
          <TriangleAlert className="mx-auto size-8 text-destructive" />
          <p className="mt-2 font-semibold">{tr("เปิดโปรแกรมไม่สำเร็จ")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage(status.error)}</p>
          <Button className="mt-4" variant="outline" onClick={() => void status.refetch()}>
            <RefreshCw /> {tr("ลองอีกครั้ง")}
          </Button>
        </div>
      </AuthShell>
    );
  }
  if (status.data.needsSetup) return <SetupScreen shopName={status.data.shopName} />;
  if (!value) return <LoginScreen status={status.data} />;

  return (
    <AuthContext.Provider value={value}>
      {children}
      <IdleLock onLock={doLogout} />
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title={tr("ออกจากระบบทั้งที่ยังไม่ได้บันทึก?")}
        description={tr("บิลที่กำลังเปิดอยู่ยังไม่ได้บันทึก ถ้าออกจากระบบตอนนี้ ข้อมูลที่กรอกไว้จะหายไป")}
        confirmText={tr("ออกจากระบบ")}
        cancelText={tr("กลับไปบันทึก")}
        destructive
        onConfirm={() => void doLogout()}
      />
    </AuthContext.Provider>
  );
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;

/** Logs out after settings.security.autoLockMinutes without mouse / keyboard use (never with unsaved work). */
function IdleLock({ onLock }: { onLock: () => void }) {
  const settings = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get(), staleTime: 60_000 });
  const minutes = settings.data?.security.autoLockMinutes ?? 0;
  const last = useRef(Date.now());
  const lockRef = useRef(onLock);
  lockRef.current = onLock;

  useEffect(() => {
    if (!minutes) return;
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - last.current >= minutes * 60_000 && !hasUnsavedWork()) lockRef.current();
    }, 15_000);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump);
      clearInterval(timer);
    };
  }, [minutes]);
  return null;
}
