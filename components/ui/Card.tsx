"use client";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { ELEVATION } from "../../lib/uiTheme";

type Padding = "sm" | "md" | "lg";

const PADDING: Record<Padding, string> = {
  sm: "px-4 py-3",
  md: "p-4",
  lg: "p-5",
};

const BASE = "rounded-2xl border border-slate-800 bg-slate-900/80";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: Padding;
  elevated?: boolean;
}

/** Shared card shell — replaces the `rounded-2xl/3xl border border-slate-800
 *  bg-slate-900` pattern duplicated across dashboard/alert panels. */
export function Card({ children, padding = "md", elevated = false, className = "", ...rest }: CardProps) {
  return (
    <div className={`${BASE} ${PADDING[padding]} ${elevated ? ELEVATION.raised : ""} ${className}`} {...rest}>
      {children}
    </div>
  );
}

interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  padding?: Padding;
}

/** Card variant for a whole card that acts as one click target (e.g. a
 *  league summary tile navigating to that league) — same shell, plus the
 *  hover/focus feedback a `<button>` needs that a plain `<div>` doesn't. */
export function CardButton({ children, padding = "md", className = "", type = "button", ...rest }: CardButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE} ${PADDING[padding]} text-left transition hover:border-slate-600 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
