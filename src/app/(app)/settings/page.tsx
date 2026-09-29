"use client";
import { Suspense } from "react";
import { SettingsFallback, SettingsView } from "@/components/settings/settings-view";

/** ตั้งค่า — sections are selected with ?section=shop|tax|docs|print|stock|backup|display|about */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsView />
    </Suspense>
  );
}
