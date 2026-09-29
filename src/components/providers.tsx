"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lang } from "@/lib/i18n";
import { makeQueryClient } from "@/lib/query";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  // The static export is pre-rendered in Thai at build time, but the page may be in English: render the app only in
  // the browser (everything loads its data there anyway), so hydration never compares Thai with English text.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Lets CSS adapt to the desktop chrome (e.g. macOS traffic-light padding).
    document.documentElement.dataset.platform = window.erp?.platform ?? "web";
    document.documentElement.lang = lang;
    setMounted(true);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          {mounted ? children : null}
          <Toaster richColors position="top-right" closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
