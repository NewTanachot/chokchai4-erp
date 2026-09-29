"use client";
/**
 * The logged-in user in the renderer. The main process enforces every rule (electron/api/access.ts); this only
 * decides what to show, so a user never sees buttons that would fail.
 */
import { createContext, useContext } from "react";
import type { Permission, SessionUser } from "@shared/contract";

export const AUTH_QUERY_KEY = ["auth", "status"] as const;

export interface AuthValue {
  user: SessionUser;
  isOwner: boolean;
  can: (p: Permission) => boolean;
  /** Log out and show the login screen (asks first when there is unsaved work). */
  logout: () => void;
}

export const AuthContext = createContext<AuthValue | null>(null);

/** The logged-in user; only use inside the app shell (the auth gate renders it). */
export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside the auth gate");
  return v;
}

/** Like useAuth, but null outside the gate (e.g. the time clock). */
export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}

export function authValue(user: SessionUser, logout: () => void): AuthValue {
  const isOwner = user.role === "owner";
  return { user, isOwner, can: (p) => isOwner || user.permissions.includes(p), logout };
}
