"use client";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "none";

const VARIANT: Record<Variant, string> = {
  primary: "rounded-full border border-transparent bg-blue-600 text-white hover:bg-blue-500",
  secondary:
    "rounded-full border border-slate-700 bg-slate-800/70 text-slate-200 hover:border-slate-600 hover:bg-slate-800",
  ghost: "rounded-full border border-white/10 bg-black/20 text-slate-200 hover:border-white/25",
  danger: "rounded-full border border-red-800 bg-red-950/40 text-red-300 hover:border-red-700 hover:bg-red-950/60",
  link: "text-blue-300 hover:text-blue-200",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[11px]",
  md: "px-3.5 py-2 text-sm",
  none: "",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Shared button primitive — variants/sizes cover the app's existing button
 *  shapes (pill actions, plain text links) so call sites stop hand-rolling
 *  Tailwind classes per instance. Focus ring is built in since most
 *  hand-rolled buttons in the app have hover feedback but no focus state. */
export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
}
