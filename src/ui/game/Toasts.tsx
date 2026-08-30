"use client";

import { useGame } from "@/sim/store";
import { cn } from "@/ui/primitives";
import { IconAlert, IconCheck, IconClose, IconCrate } from "@/ui/icons";

/**
 * Transaction feedback.
 *
 * Bottom-right, stacked, self-dismissing. Errors live longer than successes
 * because a failure is something you have to read and act on, while a success
 * is something you already expected.
 */

const STYLES = {
  success: { border: "border-good/45", bg: "bg-good/10", text: "text-good", Icon: IconCheck },
  error: { border: "border-bad/45", bg: "bg-bad/10", text: "text-bad", Icon: IconAlert },
  info: { border: "border-cyan/40", bg: "bg-cyan/10", text: "text-cyan", Icon: IconCheck },
  reward: { border: "border-amber/50", bg: "bg-amber/10", text: "text-amber", Icon: IconCrate },
} as const;

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-20 right-3 z-40 flex w-72 flex-col gap-2">
      {toasts.map((toast) => {
        const style = STYLES[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "vx-bevel animate-rise pointer-events-auto flex items-start gap-2.5 border bg-panel p-3",
              style.border
            )}
            style={{ animationDuration: "0.28s" }}
          >
            <span className={cn("mt-0.5 shrink-0", style.text)}>
              <style.Icon size={14} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-snug text-hi">{toast.title}</p>
              {toast.message && (
                <p className="mt-0.5 text-[11px] leading-snug text-mute">{toast.message}</p>
              )}
              {toast.signature && (
                <p
                  className="tnum mt-1 truncate text-[10px] text-faint"
                  title={toast.signature}
                >
                  {toast.signature.slice(0, 22)}…
                </p>
              )}
            </div>

            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 shrink-0 p-1 text-faint transition-colors hover:text-hi"
            >
              <IconClose size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
