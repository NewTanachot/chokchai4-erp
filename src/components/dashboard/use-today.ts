"use client";
import { useEffect, useMemo, useState } from "react";
import { dayRange, lastDaysRange, startOfDay } from "@/lib/format";
import { addDays } from "@/components/reports/ranges";

/**
 * Stable local-day ranges for the dashboard. Re-computes when the calendar day changes
 * (the app is often left open overnight), otherwise keeps the same objects so query keys stay stable.
 */
export function useTodayRanges(trendDays = 14) {
  const [dayStart, setDayStart] = useState(() => startOfDay(Date.now()).getTime());
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = startOfDay(Date.now()).getTime();
      setDayStart((prev) => (prev === s ? prev : s));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(
    () => ({
      now: Date.now(),
      today: dayRange(dayStart),
      yesterday: dayRange(addDays(dayStart, -1)),
      trend: lastDaysRange(trendDays, dayStart),
      /** Everything up to the end of today - for outstanding balances. */
      allTime: { from: 0, to: dayRange(dayStart).to },
    }),
    [dayStart, trendDays],
  );
}
