"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { copyText } from "./customer-utils";

/** Small icon button that copies `value` and confirms with a check mark + toast. */
export function CopyButton({
  value,
  label,
  className,
  size = "icon-xs",
}: {
  value: string;
  /** What is copied, e.g. "เบอร์โทร" -> toast "คัดลอกเบอร์โทรแล้ว". */
  label: string;
  className?: string;
  size?: "icon-xs" | "icon-sm";
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={tr("คัดลอก{0}", label)}
          className={cn("text-muted-foreground hover:text-foreground", done && "text-income hover:text-income", className)}
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ok = await copyText(value);
            if (ok) {
              setDone(true);
              toast.success(tr("คัดลอก{0}แล้ว", label), { description: value, duration: 1800 });
            } else {
              toast.error(tr("คัดลอก{0}ไม่สำเร็จ", label));
            }
          }}
        >
          {done ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tr("คัดลอก{0}", label)}</TooltipContent>
    </Tooltip>
  );
}
