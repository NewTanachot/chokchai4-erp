"use client";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { tr } from "@/lib/i18n";

/** Confirm soft-deleting a customer (bills are kept). */
export function DeleteCustomerDialog({
  open,
  onOpenChange,
  name,
  billCount,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  billCount: number;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <AlertDialogContent className="sm:max-w-md" data-shot="delete-customer-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-base">{tr("ลบลูกค้า “{0}” ?", name)}</AlertDialogTitle>
          <AlertDialogDescription>
            {billCount > 0
              ? tr("บิลเก่า {0} ใบยังอยู่ครบ และยังแสดงชื่อลูกค้าตามบิลเหมือนเดิม แต่จะไม่พบลูกค้าคนนี้ในรายชื่อและการค้นหาอีก", billCount)
              : tr("ลูกค้าคนนี้จะถูกนำออกจากรายชื่อและการค้นหา")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg" disabled={pending}>
            {tr("ยกเลิก")}
          </AlertDialogCancel>
          <AlertDialogAction
            size="lg"
            variant="destructive"
            disabled={pending}
            data-shot="confirm-delete-customer"
            onClick={(e) => {
              e.preventDefault(); // stay open until the delete finishes
              onConfirm();
            }}
          >
            {pending ? <Spinner /> : <Trash2 />} {tr("ลบลูกค้า")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
