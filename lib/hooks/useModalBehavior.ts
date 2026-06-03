"use client";
import { useEffect, useRef } from "react";

/**
 * Shared modal/panel behavior (audit batch B9). While the component is mounted it:
 *   • closes on Escape via a document-level keydown listener — more reliable than a
 *     focus-dependent onKeyDown on the dialog element, which only fires when the
 *     dialog itself (or a child) holds focus.
 *   • locks body scroll, restoring the previous value on unmount.
 *
 * These modals are conditionally rendered, so mount == open and unmount == close;
 * no isOpen flag is needed. onClose is read through a ref so an unstable inline
 * callback (e.g. `() => setX(null)`) does NOT re-run the effect and thrash the
 * scroll lock / listener on every parent render.
 */
export function useModalBehavior(onClose: () => void, options?: { lockScroll?: boolean }) {
  const lockScroll = options?.lockScroll ?? true;
  const onCloseRef = useRef(onClose);
  // Keep the ref current without re-running the listener/scroll-lock effect.
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);

    let prevOverflow = "";
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      if (lockScroll) document.body.style.overflow = prevOverflow;
    };
  }, [lockScroll]);
}
