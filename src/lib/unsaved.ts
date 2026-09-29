/**
 * Screens with unsaved work (the bill form) register here, so logging out / the auto-lock can ask first
 * instead of silently dropping it.
 */
const dirty = new Set<string>();

export function setUnsavedWork(key: string, isDirty: boolean): void {
  if (isDirty) dirty.add(key);
  else dirty.delete(key);
}

export const hasUnsavedWork = (): boolean => dirty.size > 0;
