"use client";
import { Clock, Crown, KeyRound, LogOut, UserRoundCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { USER_ROLE_LABELS } from "@shared/contract";
import { CustomerAvatar } from "@/components/customers/customer-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { ChangePasswordDialog } from "./change-password-dialog";

/** Header: who is logged in, change password, switch user / log out. */
export function UserMenu() {
  const { user, isOwner, logout } = useAuth();
  const router = useRouter();
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5 pr-2.5" data-shot="user-menu">
            <CustomerAvatar name={user.name} colorKey={user.id} size="sm" className="size-7 text-xs" />
            <span className="hidden max-w-32 truncate text-sm font-medium md:inline">{user.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
            <CustomerAvatar name={user.name} colorKey={user.id} size="md" />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{user.name}</span>
              <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                {isOwner ? <Crown className="size-3" /> : null}
                {USER_ROLE_LABELS[user.role]}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="py-2" onSelect={() => router.push("/clock/")}>
            <Clock /> {tr("ลงเวลาเข้า-ออกงาน")}
          </DropdownMenuItem>
          <DropdownMenuItem className="py-2" onSelect={() => setPwOpen(true)}>
            <KeyRound /> {user.hasPassword ? tr("เปลี่ยนรหัสผ่าน") : tr("ตั้งรหัสผ่าน")}
          </DropdownMenuItem>
          {isOwner ? (
            <DropdownMenuItem className="py-2" onSelect={() => router.push("/settings/?section=users")}>
              <UserRoundCog /> {tr("จัดการผู้ใช้งาน")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="py-2" onSelect={logout} data-shot="logout">
            <LogOut /> {tr("สลับผู้ใช้ / ออกจากระบบ")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} hasPassword={user.hasPassword} />
    </>
  );
}
