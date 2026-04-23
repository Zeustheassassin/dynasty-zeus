"use client";

import { useState, useCallback } from "react";
import { logger } from "@/lib/logger";

const log = logger("lib/hooks/useLocalStorage");

export function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function setLocalStorageItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    log.warn("quota exceeded — write skipped", { key });
  }
}

export function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // private browsing or sandboxed iframe
  }
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T
): [T, (val: T) => void, () => void] {
  const [value, setValueState] = useState<T>(() =>
    getLocalStorageItem(key, defaultValue)
  );

  const setValue = useCallback(
    (val: T) => {
      setValueState(val);
      setLocalStorageItem(key, val);
    },
    [key]
  );

  const removeValue = useCallback(() => {
    setValueState(defaultValue);
    removeLocalStorageItem(key);
  }, [key, defaultValue]);

  return [value, setValue, removeValue];
}
