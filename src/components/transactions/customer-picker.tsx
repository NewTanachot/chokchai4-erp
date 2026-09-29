"use client";
/** Searchable customer picker for bills (name / phone / plate), with "ลูกค้าใหม่". */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Car, Check, ChevronsUpDown, Phone, Search, UserPlus, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { CustomerWithStats } from "@shared/contract";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Command as CommandPrimitive } from "cmdk";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DraftCustomer } from "./bill-draft";
import { useDebounced } from "./hooks";

export const toDraftCustomer = (c: CustomerWithStats): DraftCustomer => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  shopName: c.shopName,
  vehiclePlates: c.vehiclePlates,
});

export function Initial({ name, className }: { name: string; className?: string }) {
  const ch = Array.from(name.replace(/^(คุณ|นาย|นางสาว|นาง|ร้าน|บริษัท|บจก\.?|หจก\.?)\s*/, "").replace(/^[เแโใไ]/, ""))[0] ?? "?";
  return (
    <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary", className)}>
      {ch}
    </span>
  );
}

export function CustomerPicker({
  value,
  onChange,
  onCreate,
  placeholder = tr("ค้นหาลูกค้า (ชื่อ / เบอร์โทร / ทะเบียนรถ)"),
}: {
  value: DraftCustomer | null;
  onChange: (c: DraftCustomer | null) => void;
  /** "ลูกค้าใหม่" - receives what was typed in the search box. */
  onCreate: (typed: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 150);
  const query = { search: dq || undefined, limit: 20 };
  const list = useQuery({
    queryKey: ["customers", "list", query],
    queryFn: () => api.customers.list(query),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const choose = (c: DraftCustomer | null) => {
    onChange(c);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2.5">
          <Initial name={value.name} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-medium">{value.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[value.phone, value.shopName].filter(Boolean).join(" · ") || tr("ไม่มีเบอร์โทร")}
            </div>
          </div>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
              {tr("เปลี่ยน")}
            </Button>
          </PopoverTrigger>
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => onChange(null)} aria-label={tr("ไม่ระบุลูกค้า")}>
            <X />
          </Button>
        </div>
      ) : (
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none dark:bg-input/30"
            data-shot="customer-picker"
          >
            <Search className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
      )}
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-[320px] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Command shouldFilter={false} className="rounded-lg!">
          <div className="flex items-center gap-2 border-b px-3">
            {list.isFetching ? <Spinner className="text-muted-foreground" /> : <Search className="size-4 shrink-0 text-muted-foreground" />}
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder={tr("ชื่อ, เบอร์โทร หรือทะเบียนรถ")}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandList className="max-h-80">
            {list.isPending ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner /> {tr("กำลังโหลด…")}
              </div>
            ) : (
              <CommandEmpty className="py-5 text-sm text-muted-foreground">{tr("ไม่พบลูกค้า “{0}”", dq)}</CommandEmpty>
            )}
            {!dq ? (
              <CommandGroup>
                <CommandItem value="__walkin" onSelect={() => choose(null)} className="gap-3 py-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-4" />
                  </span>
                  <span className="flex-1">
                    {tr("ลูกค้าทั่วไป")}
                    <span className="block text-xs text-muted-foreground">{tr("ไม่ต้องบันทึกข้อมูลลูกค้า")}</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {list.data?.items.length ? (
              <CommandGroup heading={dq ? tr("ผลการค้นหา ({0})", list.data.total) : tr("ลูกค้าล่าสุด")}>
                {list.data.items.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => choose(toDraftCustomer(c))} className="gap-3 py-2">
                    <Initial name={c.name} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        {c.phone ? (
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <Phone className="size-3" />
                            {c.phone}
                          </span>
                        ) : null}
                        {c.vehiclePlates.length ? <span className="inline-flex min-w-0 items-center gap-1 truncate">
                            <Car className="size-3 shrink-0" />
                            <span className="truncate">{c.vehiclePlates.slice(0, 2).join(", ")}</span>
                          </span> : null}
                      </span>
                    </span>
                    {value?.id === c.id ? <Check className="size-4 text-primary" /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
          <CommandSeparator />
          <div className="p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate(q.trim());
                setQ("");
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-primary hover:bg-accent"
              data-shot="new-customer"
            >
              <UserPlus className="size-4" />
              {q.trim() ? tr("เพิ่มลูกค้าใหม่ “{0}”", q.trim()) : tr("เพิ่มลูกค้าใหม่")}
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
