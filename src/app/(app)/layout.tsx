"use client";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const KEY = "sidebar-open";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) setOpen(v === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return (
    <AuthGate>
      <SidebarProvider open={open} onOpenChange={onOpenChange}>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGate>
  );
}
