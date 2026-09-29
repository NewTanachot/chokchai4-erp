"use client";
import { Check, Copy, KeyRound } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/components/customers/customer-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { tr } from "@/lib/i18n";

/**
 * Shows a recovery code once, with a copy button, and only lets the owner continue after confirming it was written
 * down (it is the only way back in if the owner forgets the password).
 */
export function RecoveryCodePanel({ code, onDone, doneText = tr("ดำเนินการต่อ") }: { code: string; onDone: () => void; doneText?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="space-y-4" data-shot="recovery-code">
      <div className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-warning-foreground dark:text-warning" />
        <p className="leading-relaxed">
          <b>{tr("รหัสกู้คืน")}</b> {tr("ใช้ตั้งรหัสผ่านใหม่ถ้าเจ้าของร้านลืมรหัสผ่าน กรุณาจดใส่กระดาษหรือถ่ายรูปเก็บไว้ในที่ปลอดภัย ระบบจะแสดงรหัสนี้ครั้งเดียวเท่านั้น")}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/40 px-4 py-5">
        <span className="font-mono text-2xl font-semibold tracking-[0.12em] whitespace-nowrap select-all" data-shot="recovery-code-value">
          {code}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tr("คัดลอกรหัสกู้คืน")}
          onClick={async () => {
            if (await copyText(code)) {
              setCopied(true);
              toast.success(tr("คัดลอกรหัสกู้คืนแล้ว"));
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <div className="flex items-center gap-2.5">
        <Checkbox id={id} checked={saved} onCheckedChange={(v) => setSaved(v === true)} className="size-5" />
        <Label htmlFor={id} className="cursor-pointer text-sm leading-snug">
          {tr("ฉันจดรหัสกู้คืนเก็บไว้แล้ว")}
        </Label>
      </div>
      <Button type="button" size="lg" className="h-11 w-full text-base" disabled={!saved} onClick={onDone} data-shot="recovery-done">
        {doneText}
      </Button>
    </div>
  );
}
