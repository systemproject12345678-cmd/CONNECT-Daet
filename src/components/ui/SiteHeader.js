"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StarMark } from "@/components/ui/DashboardShell";

const LINKS = [
  { href: "/", label: "Home", match: (p) => p === "/" },
  { href: "/programs", label: "Programs", match: (p) => p.startsWith("/programs") },
];

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-stone-200 dark:border-slate-800 shadow-sm font-sans transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-slate-700 text-stone-50 shadow-sm group-hover:bg-slate-800 dark:bg-slate-800 dark:border dark:border-slate-700 dark:group-hover:bg-slate-700 transition-colors">
            <StarMark size={16} />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-black tracking-tight text-slate-900 dark:text-slate-100 leading-none font-display">
              CONNECT-Daet
            </span>
            <span className="text-[10px] font-bold text-stone-500 dark:text-slate-400 uppercase tracking-wider mt-0.5">
              Tourism Events
            </span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-6" aria-label="Main">
          {LINKS.map((l) => {
            const isActive = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive ? "page" : undefined}
                className={`text-sm font-bold transition-colors ${
                  isActive
                    ? "text-slate-900 dark:text-slate-100"
                    : "text-stone-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <button
          className="md:hidden p-2 text-slate-600 hover:bg-stone-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 rounded-xl transition-colors"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle mobile menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isMobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 w-full bg-white border-b border-stone-200 dark:bg-slate-900 dark:border-slate-800 shadow-xl">
          <nav className="flex flex-col px-4 py-4 space-y-2">
            {LINKS.map((l) => {
              const isActive = l.match(pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`block px-4 py-3 rounded-xl text-sm font-bold transition-colors ${
                    isActive
                      ? "bg-stone-200/80 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                      : "text-slate-600 hover:bg-stone-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}