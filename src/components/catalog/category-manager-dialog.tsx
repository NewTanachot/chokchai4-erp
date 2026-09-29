"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Category } from "@shared/contract";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { LOCALE, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

/**
 * Manage product categories: add, rename inline, reorder, delete.
 * `onShowProducts` (optional) lets the "can't delete, still has products" message jump to that category's products.
 */
export function CategoryManagerDialog({
  open,
  onOpenChange,
  onShowProducts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowProducts?: (categoryId: string) => void;
}) {
  const list = useQuery({ queryKey: ["categories", "list"], queryFn: () => api.categories.list(), enabled: open });
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNewName("");
      setAddError(null);
      setEditingId(null);
    }
  }, [open]);

  const create = useApiMutation((name: string) => api.categories.create({ name }), {
    successMessage: (c) => tr("เพิ่มหมวดหมู่ “{0}” แล้ว", c.name),
    toastError: false,
    onSuccess: () => {
      setNewName("");
      requestAnimationFrame(() => addRef.current?.focus());
    },
    onError: (e) => setAddError(e.message),
  });
  const reorder = useApiMutation((ids: string[]) => api.categories.reorder(ids));
  const remove = useApiMutation((id: string) => api.categories.remove(id), {
    successMessage: tr("ลบหมวดหมู่แล้ว"),
    onSettled: () => setDeleting(null),
  });

  const cats = list.data ?? [];
  const move = (index: number, dir: -1 | 1) => {
    const ids = cats.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return setAddError(tr("กรุณากรอกชื่อหมวดหมู่"));
    setAddError(null);
    create.mutate(name);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto_auto] sm:max-w-lg"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            addRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-lg">{tr("หมวดหมู่สินค้า")}</DialogTitle>
            <DialogDescription>{tr("จัดกลุ่มสินค้า เช่น ยาง แบตเตอรี่ ช่วงล่าง — ลำดับนี้ใช้แสดงในหน้าสินค้า")}</DialogDescription>
          </DialogHeader>

          <div className="-mx-4 min-h-0 overflow-y-auto px-4">
            {list.isPending ? (
              <div className="grid gap-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : cats.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <FolderOpen className="size-6" />
                {tr("ยังไม่มีหมวดหมู่ — เพิ่มหมวดหมู่แรกด้านล่าง")}
              </div>
            ) : (
              <ul className="divide-y rounded-lg border">
                {cats.map((c, i) => (
                  <CategoryRow
                    key={c.id}
                    category={c}
                    editing={editingId === c.id}
                    onEdit={() => setEditingId(c.id)}
                    onDone={() => setEditingId(null)}
                    onUp={i > 0 ? () => move(i, -1) : undefined}
                    onDown={i < cats.length - 1 ? () => move(i, 1) : undefined}
                    onDelete={() => setDeleting(c)}
                    busy={reorder.isPending}
                  />
                ))}
              </ul>
            )}
          </div>

          <form
            className="grid gap-1.5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor="cat-new" className="text-sm font-medium">
              {tr("เพิ่มหมวดหมู่ใหม่")}
            </label>
            <div className="flex gap-2">
              <Input
                id="cat-new"
                ref={addRef}
                className="h-9"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (addError) setAddError(null);
                }}
                placeholder={tr("เช่น ล้อแม็ก, ผ้าเบรก")}
                aria-invalid={!!addError}
                autoComplete="off"
                maxLength={100}
              />
              <Button type="submit" size="lg" disabled={create.isPending} data-shot="category-add">
                {create.isPending ? <Spinner /> : <Plus />} {tr("เพิ่ม")}
              </Button>
            </div>
            {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          </form>

          <DialogFooter>
            <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
              {tr("เสร็จสิ้น")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleting && deleting.productCount > 0 ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={tr("ลบ “{0}” ไม่ได้", deleting.name)}
          description={tr("หมวดหมู่นี้ยังมีสินค้าอยู่ {0} รายการ — ย้ายสินค้าไปหมวดอื่น (หรือลบสินค้า) ก่อน จึงจะลบหมวดหมู่นี้ได้", deleting.productCount.toLocaleString(LOCALE))}
          confirmText={onShowProducts ? tr("ดูสินค้าในหมวดนี้") : tr("เข้าใจแล้ว")}
          cancelText={tr("ปิด")}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            if (onShowProducts) {
              onOpenChange(false);
              onShowProducts(id);
            }
          }}
        />
      ) : (
        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(null)}
          title={tr("ลบหมวดหมู่ “{0}”?", deleting?.name ?? "")}
          description={tr("หมวดหมู่นี้ไม่มีสินค้าแล้ว ลบได้เลย")}
          confirmText={tr("ลบหมวดหมู่")}
          destructive
          onConfirm={() => {
            if (deleting) remove.mutate(deleting.id);
          }}
        />
      )}
    </>
  );
}

function CategoryRow({
  category,
  editing,
  onEdit,
  onDone,
  onUp,
  onDown,
  onDelete,
  busy,
}: {
  category: Category;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (editing) {
      setName(category.name);
      setError(null);
    }
  }, [editing, category.name]);

  const rename = useApiMutation((n: string) => api.categories.update({ id: category.id, name: n }), {
    successMessage: tr("เปลี่ยนชื่อแล้ว"),
    toastError: false,
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });

  const save = () => {
    const n = name.trim();
    if (!n) return setError(tr("กรุณากรอกชื่อหมวดหมู่"));
    if (n === category.name) return onDone();
    rename.mutate(n);
  };

  if (editing) {
    return (
      <li className="grid gap-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            className="h-9"
            value={name}
            aria-label={tr("ชื่อหมวดหมู่")}
            aria-invalid={!!error}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onDone();
              }
            }}
          />
          <Button size="icon-lg" onClick={save} disabled={rename.isPending} aria-label={tr("บันทึกชื่อ")}>
            {rename.isPending ? <Spinner /> : <Check />}
          </Button>
          <Button size="icon-lg" variant="ghost" onClick={onDone} aria-label={tr("ยกเลิก")}>
            <X />
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2 py-1.5 pr-1.5 pl-3">
      <button
        type="button"
        className="min-w-0 flex-1 truncate py-1.5 text-left text-sm font-medium"
        onDoubleClick={onEdit}
        title={tr("ดับเบิลคลิกเพื่อเปลี่ยนชื่อ")}
      >
        {category.name}
      </button>
      <span
        className={cn(
          "num shrink-0 rounded-full px-2 py-0.5 text-xs",
          category.productCount > 0 ? "bg-muted text-muted-foreground" : "text-muted-foreground/70",
        )}
      >
        {category.productCount > 0 ? tr("{0} สินค้า", category.productCount.toLocaleString(LOCALE)) : tr("ว่าง")}
      </span>
      <div className="flex shrink-0 items-center">
        <IconAction label={tr("เลื่อนขึ้น")} onClick={onUp} disabled={!onUp || busy}>
          <ArrowUp />
        </IconAction>
        <IconAction label={tr("เลื่อนลง")} onClick={onDown} disabled={!onDown || busy}>
          <ArrowDown />
        </IconAction>
        <IconAction label={tr("เปลี่ยนชื่อ")} onClick={onEdit}>
          <Pencil />
        </IconAction>
        <IconAction label={tr("ลบ")} onClick={onDelete} className="hover:bg-destructive/10 hover:text-destructive">
          <Trash2 />
        </IconAction>
      </div>
    </li>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled} className={cn("text-muted-foreground", className)}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
