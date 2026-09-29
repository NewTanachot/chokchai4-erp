import { Construction } from "lucide-react";
import { tr } from "@/lib/i18n";

/** Placeholder for pages that are not built yet. */
export function ComingSoon({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-16 text-center text-muted-foreground">
      <Construction className="size-8" />
      <p>{tr("{0} — กำลังพัฒนา", what)}</p>
    </div>
  );
}
