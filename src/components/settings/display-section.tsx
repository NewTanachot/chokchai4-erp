"use client";
import { Check, Languages, Laptop, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { intlLocaleOf, LANGUAGES } from "@shared/i18n";
import { changeLanguage } from "@/components/language-toggle";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { lang, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SectionCard } from "./section-card";

type ThemeChoice = "light" | "dark" | "system";

const THEMES: { value: ThemeChoice; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "light", label: tr("สว่าง"), hint: tr("พื้นขาว อ่านง่ายในที่สว่าง"), icon: Sun },
  { value: "dark", label: tr("มืด"), hint: tr("ถนอมสายตาในที่แสงน้อย"), icon: Moon },
  { value: "system", label: tr("ตามระบบ"), hint: tr("เปลี่ยนตามการตั้งค่าของเครื่อง"), icon: Laptop },
];

/** Miniature app window drawn with fixed light/dark palettes (a preview must not follow the current theme). */
function MiniApp({ dark }: { dark: boolean }) {
  const c = dark
    ? { bg: "#1b1d2b", side: "#141522", card: "#242738", line: "#3a3e55", text: "#d9dbe8", accent: "#a5a8e0" }
    : { bg: "#f4f5f9", side: "#2b2e55", card: "#ffffff", line: "#e2e4ee", text: "#2b2e55", accent: "#3d4185" };
  return (
    <div className="flex h-full w-full" style={{ background: c.bg }}>
      <div className="flex w-[26%] flex-col gap-1.5 p-2" style={{ background: c.side }}>
        <div className="h-2 w-3/4 rounded-sm" style={{ background: dark ? c.accent : "#e8e9f3" }} />
        <div className="h-1.5 w-full rounded-sm opacity-50" style={{ background: dark ? c.line : "#6b6fa6" }} />
        <div className="h-1.5 w-5/6 rounded-sm opacity-50" style={{ background: dark ? c.line : "#6b6fa6" }} />
        <div className="h-1.5 w-2/3 rounded-sm opacity-50" style={{ background: dark ? c.line : "#6b6fa6" }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="h-2 w-1/2 rounded-sm" style={{ background: c.text, opacity: 0.8 }} />
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 flex-1 rounded" style={{ background: c.card, border: `1px solid ${c.line}` }}>
              <div className="m-1 h-1 w-1/2 rounded-sm" style={{ background: c.line }} />
              <div className="mx-1 h-1.5 w-3/4 rounded-sm" style={{ background: i === 0 ? c.accent : c.text, opacity: 0.7 }} />
            </div>
          ))}
        </div>
        <div className="flex-1 rounded" style={{ background: c.card, border: `1px solid ${c.line}` }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mx-1.5 mt-1.5 h-1 rounded-sm" style={{ background: c.line }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DisplaySection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? theme : undefined) ?? "system";
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div className="space-y-6">
      <SectionCard
        icon={Languages}
        title={tr("ภาษา")}
        description={tr("ภาษาของโปรแกรมบนเครื่องนี้ เปลี่ยนแล้วหน้าจอจะโหลดใหม่ (ภาษาของใบเสร็จและสลิปตั้งแยกได้ที่ การพิมพ์)")}
      >
        <div role="radiogroup" aria-label={tr("ภาษา")} className="grid gap-3 @xl/settings:grid-cols-2">
          {LANGUAGES.map((l) => {
            const active = lang === l.value;
            const sample = new Intl.DateTimeFormat(intlLocaleOf(l.value), { day: "numeric", month: "short", year: "numeric" }).format(Date.now());
            return (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void changeLanguage(l.value)}
                data-shot={`settings-language-${l.value}`}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "border-primary ring-2 ring-primary/30",
                )}
              >
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold", active ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {l.short}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{l.label}</span>
                  <span className="block text-xs text-muted-foreground" suppressHydrationWarning>
                    {sample}
                  </span>
                </span>
                {active ? <Check className="size-4 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard icon={Palette} title={tr("ธีมสี")} description={tr("เลือกแล้วเปลี่ยนทันที ไม่ต้องกดบันทึก")}>
        <div role="radiogroup" aria-label={tr("ธีมสี")} className="grid gap-4 @xl/settings:grid-cols-3">
          {THEMES.map((t) => {
            const active = current === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(t.value)}
                data-shot={`theme-${t.value}`}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-xl border text-left transition-all outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "border-primary ring-2 ring-primary/30",
                )}
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden border-b">
                  {t.value === "system" ? (
                    <div className="absolute inset-0 flex">
                      <div className="relative w-1/2 overflow-hidden">
                        <div className="absolute inset-y-0 left-0 w-[200%]">
                          <MiniApp dark={false} />
                        </div>
                      </div>
                      <div className="relative w-1/2 overflow-hidden">
                        <div className="absolute inset-y-0 right-0 w-[200%]">
                          <MiniApp dark />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <MiniApp dark={t.value === "dark"} />
                  )}
                  {active ? (
                    <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="size-3.5" />
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <t.icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{t.hint}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title={tr("ขนาดตัวอักษร / ขยายหน้าจอ")} description={tr("ปรับให้อ่านง่ายขึ้นได้ตลอดเวลา จากแป้นพิมพ์หรือเมนู มุมมอง")}>
        <ul className="grid gap-3 @xl/settings:grid-cols-3">
          {[
            { label: tr("ขยายใหญ่ขึ้น"), keys: [mod, "+"] },
            { label: tr("ย่อให้เล็กลง"), keys: [mod, "−"] },
            { label: tr("กลับขนาดปกติ"), keys: [mod, "0"] },
          ].map((z) => (
            <li key={z.label} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
              <span className="text-sm">{z.label}</span>
              <KbdGroup>
                {z.keys.map((k, i) => (
                  <Kbd key={i} className="h-6 min-w-6 px-1.5 text-sm">
                    {k}
                  </Kbd>
                ))}
              </KbdGroup>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
