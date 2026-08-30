"use client";

import clsx from "clsx";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { RARITY_META, type Rarity } from "@/sim/types";
import { IconClose } from "./icons";

export const cn = clsx;

/**
 * The shared component vocabulary.
 *
 * Deliberately small and deliberately opinionated. Everything is built from
 * the same few ideas — hard 1px edges, a top-light/bottom-dark bevel, amber
 * for anything that commits an action — so the landing page, the in-game HUD
 * and the marketplace read as one product rather than three.
 */

/* ==========================================================================
   Button
   ========================================================================== */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-amber text-[#1a0e02] border-amber-hi hover:bg-amber-hi active:bg-amber-lo " +
    "shadow-[0_0_20px_-6px_var(--color-amber)] font-semibold",
  secondary:
    "bg-raised text-hi border-edge-hi hover:bg-hover hover:border-amber/50",
  ghost: "bg-transparent text-body border-transparent hover:bg-raised hover:text-hi",
  danger: "bg-bad/15 text-bad border-bad/45 hover:bg-bad/25",
  outline: "bg-transparent text-amber border-amber/55 hover:bg-amber/12",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[11px] gap-1.5",
  md: "h-10 px-4 text-[13px] gap-2",
  lg: "h-12 px-6 text-sm gap-2.5",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  full = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "vx-bevel relative inline-flex items-center justify-center border font-display",
        "uppercase tracking-[0.07em] transition-all duration-150",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
        "active:translate-y-px",
        VARIANTS[variant],
        SIZES[size],
        full && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block border-current border-b-transparent"
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(2, size / 7),
        animation: "vx-spin-slow 0.65s linear infinite",
      }}
    />
  );
}

/* ==========================================================================
   Surfaces
   ========================================================================== */

export function Panel({
  children,
  className,
  ticks = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ticks?: boolean }) {
  return (
    <div className={cn("vx-panel", ticks && "vx-ticks", className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-edge px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <h3 className="font-display text-[13px] uppercase tracking-[0.11em] text-hi">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-mute">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({
  children,
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "vx-bevel border border-edge bg-crust transition-colors",
        interactive && "cursor-pointer hover:border-edge-hi hover:bg-panel",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ==========================================================================
   Rarity
   ========================================================================== */

export function RarityBadge({
  rarity,
  size = "md",
}: {
  rarity: Rarity;
  size?: "sm" | "md";
}) {
  const meta = RARITY_META[rarity];
  return (
    <span
      className={cn(
        "inline-flex items-center border font-display uppercase tracking-[0.1em]",
        size === "sm" ? "h-[18px] px-1.5 text-[9px]" : "h-6 px-2 text-[10px]"
      )}
      style={{
        color: meta.color,
        borderColor: `${meta.color}55`,
        background: `${meta.color}14`,
      }}
    >
      {meta.label}
    </span>
  );
}

/** A left edge stripe in the rarity colour — used on item cards and rows. */
export function RarityEdge({ rarity }: { rarity: Rarity }) {
  const meta = RARITY_META[rarity];
  return (
    <span
      className="absolute inset-y-0 left-0 w-[3px]"
      style={{
        background: meta.color,
        boxShadow: meta.glow > 0.3 ? `0 0 12px 0 ${meta.color}` : undefined,
      }}
    />
  );
}

/* ==========================================================================
   Meters

   Segmented rather than continuous. A smooth bar reads as generic web UI; a
   bar made of discrete blocks reads as part of this game, and has the useful
   side effect of making small changes legible at a glance.
   ========================================================================== */

export function Meter({
  value,
  max,
  segments = 20,
  color = "var(--color-amber)",
  className,
  showTrack = true,
}: {
  value: number;
  max: number;
  segments?: number;
  color?: string;
  className?: string;
  showTrack?: boolean;
}) {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const filled = ratio * segments;

  return (
    <div className={cn("flex h-2 gap-[2px]", className)} role="presentation">
      {Array.from({ length: segments }, (_, i) => {
        // The partially-filled segment fades rather than snapping, so the bar
        // still animates smoothly despite being discrete.
        const fill = Math.max(0, Math.min(1, filled - i));
        return (
          <span
            key={i}
            className="flex-1"
            style={{
              background:
                fill > 0
                  ? `color-mix(in oklab, ${color} ${Math.round(fill * 100)}%, ${
                      showTrack ? "var(--color-raised)" : "transparent"
                    })`
                  : showTrack
                    ? "var(--color-raised)"
                    : "transparent",
            }}
          />
        );
      })}
    </div>
  );
}

export function Bar({
  value,
  max,
  color = "var(--color-amber)",
  className,
  height = 4,
}: {
  value: number;
  max: number;
  color?: string;
  className?: string;
  height?: number;
}) {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className={cn("w-full bg-raised", className)} style={{ height }}>
      <div
        className="h-full transition-[width] duration-200"
        style={{ width: `${ratio * 100}%`, background: color }}
      />
    </div>
  );
}

/* ==========================================================================
   Data display
   ========================================================================== */

export function Stat({
  label,
  value,
  hint,
  icon,
  accent,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.13em] text-mute">
        {icon}
        {label}
      </div>
      <div
        className="tnum mt-1 truncate text-lg font-semibold leading-none text-hi"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-[11px] text-mute">{hint}</div>}
    </div>
  );
}

export function Chip({
  children,
  color,
  className,
  onClick,
  active = false,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Component = onClick ? "button" : "span";
  return (
    <Component
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border px-2 text-[11px] transition-colors",
        onClick && "cursor-pointer hover:border-edge-hi",
        active ? "border-amber/60 bg-amber/12 text-amber" : "border-edge bg-crust text-body",
        className
      )}
      style={color && !active ? { color, borderColor: `${color}44` } : undefined}
    >
      {children}
    </Component>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="font-display text-sm text-body">{title}</p>
      {message && <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-mute">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ==========================================================================
   Modal
   ========================================================================== */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-lg",
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // The game canvas listens for keys globally, so Escape has to be handled
    // here and stopped before it reaches the camera controller.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissable) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);

    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={dismissable ? onClose : undefined}
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(
          "vx-panel vx-ticks animate-rise relative w-full outline-none",
          width
        )}
      >
        {(title || dismissable) && (
          <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              {title && (
                <h2 className="font-display text-base uppercase tracking-[0.08em] text-hi">
                  {title}
                </h2>
              )}
              {subtitle && <p className="mt-1 text-xs text-mute">{subtitle}</p>}
            </div>
            {dismissable && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 p-1.5 text-mute transition-colors hover:text-hi"
              >
                <IconClose size={16} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ==========================================================================
   Tabs
   ========================================================================== */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex border-b border-edge", className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative -mb-px border-b-2 px-3.5 py-2.5 font-display text-[11px] uppercase tracking-[0.1em] transition-colors",
              active
                ? "border-amber text-amber"
                : "border-transparent text-mute hover:text-body"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tnum ml-1.5 text-[10px] opacity-65">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Misc
   ========================================================================== */

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-edge", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center border border-edge-hi bg-raised px-1.5 font-mono text-[10px] text-body">
      {children}
    </kbd>
  );
}

/** Small monospace label for addresses and signatures. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("tnum text-[11px] text-mute", className)}>{children}</span>;
}
