import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  Contact,
  History,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@shared/contract";
import { tr, trc } from "@/lib/i18n";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
  /** Exact match only (for "/" and "new" links carrying query params). */
  exact?: boolean;
  /** Shown only to users with (any of) these permissions. */
  permission?: Permission | Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: tr("ภาพรวม"),
    items: [{ title: tr("แดชบอร์ด"), href: "/", icon: LayoutDashboard, exact: true }],
  },
  {
    label: tr("งานประจำวัน"),
    items: [
      { title: tr("ขายสินค้า / บริการ"), href: "/transactions/new/?type=sale", icon: ShoppingCart, exact: true },
      { title: tr("บันทึกการซื้อ"), href: "/transactions/new/?type=purchase", icon: ShoppingBag, exact: true, permission: "purchases.create" },
      { title: tr("รายการซื้อ-ขาย"), href: "/transactions/", icon: ClipboardList, match: ["/transactions/view", "/transactions/edit"] },
    ],
  },
  {
    label: tr("ข้อมูลร้าน"),
    items: [
      { title: tr("สินค้า & สต็อก"), href: "/products/", icon: Package },
      { title: trc("plural", "บริการ"), href: "/services/", icon: Wrench },
      { title: trc("plural", "ลูกค้า"), href: "/customers/", icon: Users },
    ],
  },
  {
    label: trc("nav", "พนักงาน"),
    items: [
      { title: tr("เวลาทำงาน"), href: "/attendance/", icon: CalendarClock, permission: ["attendance.manage", "employees.manage"] },
      { title: tr("ข้อมูลพนักงาน"), href: "/employees/", icon: Contact, match: ["/employees/view"], permission: "employees.manage" },
      { title: trc("nav", "เงินเดือน"), href: "/payroll/", icon: Wallet, match: ["/payroll/view"], permission: "employees.manage" },
    ],
  },
  {
    label: tr("สรุปผล"),
    items: [
      { title: tr("รายงาน"), href: "/reports/", icon: BarChart3, permission: "reports.view" },
      { title: tr("ประวัติการแก้ไข"), href: "/audit/", icon: History, permission: "audit.view" },
    ],
  },
];

/** Nav groups with only the items this user may open (empty groups dropped). */
export function visibleNav(can: (p: Permission) => boolean): NavGroup[] {
  const allowed = (item: NavItem) => !item.permission || (Array.isArray(item.permission) ? item.permission : [item.permission]).some(can);
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);
}

export const SETTINGS_NAV: NavItem = { title: tr("ตั้งค่า"), href: "/settings/", icon: Settings };

const norm = (p: string) => (p.endsWith("/") ? p : p + "/");

export function isNavActive(item: NavItem, pathname: string, search: string): boolean {
  const [hrefPath, hrefQuery] = item.href.split("?");
  const path = norm(pathname);
  if (item.exact) {
    if (norm(hrefPath) !== path) return false;
    if (!hrefQuery) return true;
    const want = new URLSearchParams(hrefQuery);
    const have = new URLSearchParams(search);
    return [...want.entries()].every(([k, v]) => have.get(k) === v);
  }
  if (path === norm(hrefPath)) return true;
  return (item.match ?? []).some((m) => path.startsWith(norm(m)));
}
