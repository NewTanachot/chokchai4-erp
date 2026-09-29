"use client";
import { Check, Languages } from "lucide-react";
import { toast } from "sonner";
import { LANGUAGES, type Lang } from "@shared/i18n";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/lib/api";
import { lang, setLanguage, tr } from "@/lib/i18n";
import { hasUnsavedWork } from "@/lib/unsaved";
import { cn } from "@/lib/utils";

/** Switches the program language (the page reloads). Not while a bill has unsaved changes. */
export async function changeLanguage(next: Lang): Promise<void> {
  if (next === lang) return;
  if (hasUnsavedWork()) {
    toast.warning(tr("บันทึกหรือยกเลิกบิลที่เปิดอยู่ก่อน แล้วค่อยเปลี่ยนภาษา"));
    return;
  }
  try {
    await setLanguage(next);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Header / login-screen button: TH / EN. */
export function LanguageToggle({ className, variant = "ghost" }: { className?: string; variant?: "ghost" | "outline" }) {
  const current = LANGUAGES.find((l) => l.value === lang) ?? LANGUAGES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" className={cn("h-9 gap-1.5 px-2.5", className)} aria-label={tr("เปลี่ยนภาษา")} data-shot="language-toggle">
          <Languages />
          <span className="text-xs font-semibold tracking-wide">{current.short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr("ภาษา")} / Language</DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.value} className="py-2" onSelect={() => void changeLanguage(l.value)} data-shot={`language-${l.value}`}>
            <span className="w-7 text-xs font-semibold text-muted-foreground">{l.short}</span>
            {l.label}
            {l.value === lang ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
