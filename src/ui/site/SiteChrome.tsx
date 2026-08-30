"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, cn } from "@/ui/primitives";
import { IconExternal } from "@/ui/icons";

/**
 * Site-wide navigation and footer.
 *
 * Shared with the game shell so the header never jumps between routes.
 */

export function Logo({ size = 26, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        {/* Three strata layers seen edge-on, lit from above like the world is. */}
        <path d="M16 3 29 10 16 17 3 10z" fill="var(--color-amber-hi)" />
        <path d="M16 17 3 10v4l13 7 13-7v-4z" fill="var(--color-amber)" opacity="0.75" />
        <path d="M16 24 3 17v4l13 7 13-7v-4z" fill="var(--color-amber-lo)" opacity="0.7" />
      </svg>
      {withText && (
        <span className="font-display text-[17px] font-bold uppercase tracking-[0.22em] text-hi">
          Strata
        </span>
      )}
    </span>
  );
}

const NAV_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#economy", label: "Economy" },
  { href: "/#crates", label: "Crates" },
  { href: "/#market", label: "Market" },
  { href: "/#roadmap", label: "Roadmap" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled
          ? "border-b border-edge bg-void/88 backdrop-blur-lg"
          : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-[13px] text-body transition-colors hover:text-hi"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/play" className="hidden sm:block">
            <Button variant="primary" size="sm">
              Play now
            </Button>
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
            className="p-2 text-body lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              {open ? (
                <path d="M5 5l14 14M19 5L5 19" />
              ) : (
                <path d="M3 7h18M3 12h18M3 17h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-edge bg-deep lg:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="border-b border-edge/60 py-3 text-sm text-body last:border-0"
              >
                {link.label}
              </Link>
            ))}
            <Link href="/play" onClick={() => setOpen(false)} className="py-3">
              <Button variant="primary" size="sm" full>
                Play now
              </Button>
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

const FOOTER_GROUPS = [
  {
    title: "Game",
    links: [
      { href: "/play", label: "Play" },
      { href: "/#how", label: "How it works" },
      { href: "/#crates", label: "Crates & odds" },
      { href: "/#market", label: "Marketplace" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: "/#economy", label: "Economy" },
      { href: "/#roadmap", label: "Roadmap" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
];

export function SiteFooter({ repoUrl }: { repoUrl?: string }) {
  return (
    <footer className="border-t border-edge bg-deep">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-mute">
              A browser voxel mining city sim. Built in the open, with a simulated economy
              and an on-chain layer that is wired but not yet switched on.
            </p>
            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-5 inline-flex items-center gap-2 text-sm text-body transition-colors hover:text-amber"
              >
                <IconExternal size={15} />
                Source on GitHub
              </a>
            )}
          </div>

          {FOOTER_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="font-display text-[11px] uppercase tracking-[0.14em] text-mute">
                {group.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-body transition-colors hover:text-hi"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-edge pt-6">
          <p className="text-xs leading-relaxed text-faint">
            STRATA is a game and a technical demonstration. The in-game currency is simulated
            and has no monetary value. No token has been issued, none is offered for sale, and
            nothing on this site is an investment offer or financial advice.
          </p>
          <p className="mt-3 text-xs text-faint">
            © {new Date().getFullYear()} STRATA. Built with Next.js and Three.js.
          </p>
        </div>
      </div>
    </footer>
  );
}
