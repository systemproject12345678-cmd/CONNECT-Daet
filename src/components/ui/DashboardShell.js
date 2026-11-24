"use client";

import { useState } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

const ICONS = {
  home: ["M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"],
  shield: ["M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z", "m9 12 2 2 4-4"],
  calendar: ["M7 3v3M17 3v3M4 9h16", "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"],
  "calendar-check": ["M7 3v3M17 3v3M4 9h16", "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "m9.5 14.5 2 2 3.5-4"],
  "x-circle": ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "m9 9 6 6m0-6-6 6"],
  users: [
    "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20",
    "M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.6a3.5 3.5 0 0 1 0 6.8",
  ],
  bell: ["M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z", "M10 20a2 2 0 0 0 4 0"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M5 20a7 7 0 0 1 14 0"],
  settings: ["M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6"],
  ticket: ["M4 8a2 2 0 0 1 0 4 2 2 0 0 1 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4z"],
  plus: ["M12 5v14M5 12h14"],
  logout: ["M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4", "m16 17 5-5-5-5M21 12H9"],
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["M6 6l12 12M18 6 6 18"],
  arrow: ["M7 17 17 7M8 7h9v9"],
};

export function Icon({ name, size = 18, className = "" }) {
  const paths = ICONS[name] || [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function StarMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points="12,2.5 14.9,9 22,9.6 16.6,14.3 18.2,21.2 12,17.5 5.8,21.2 7.4,14.3 2,9.6 9.1,9"
        fill="#d9a036"
      />
    </svg>
  );
}

export default function DashboardShell({
  roleLabel,
  name,
  subtitle,
  nav,
  activeKey,
  onNavigate,
  primaryAction,
  onLogout,
  children,
}) {
  const [open, setOpen] = useState(false);
  const active = nav.find((n) => n.key === activeKey);
  const today = new Date().toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });

  const go = (key) => {
    onNavigate(key);
    setOpen(false);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-stone-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100 font-sans overflow-hidden transition-colors">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col w-64 bg-white border-r border-stone-200 dark:bg-slate-900 dark:border-slate-800 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label={`${roleLabel} navigation`}
      >
        <div className="p-6 border-b border-stone-200/80 dark:border-slate-800">
          <p className="text-xs font-semibold tracking-wider text-stone-500 dark:text-slate-400 uppercase">{roleLabel}</p>
          <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100 truncate">{name}</p>
          {subtitle && <p className="text-sm text-stone-500 dark:text-slate-400 truncate">{subtitle}</p>}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const isActive = activeKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => go(item.key)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center w-full px-3 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                  isActive
                    ? "bg-stone-200/80 text-slate-900 font-semibold dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:bg-stone-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                }`}
              >
                <Icon
                  name={item.icon}
                  className={isActive ? "text-slate-900 dark:text-slate-100" : "text-stone-400 dark:text-slate-500"}
                />
                <span className="flex-1 ml-3 text-left">{item.label}</span>
                {item.badge > 0 && (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 ml-auto text-xs font-semibold rounded-full ${
                      item.tone === "red"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200"
                        : item.tone === "blue"
                        ? "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 space-y-2.5 border-t border-stone-200/80 dark:border-slate-800">
          {primaryAction && (
            <Link
              href={primaryAction.href}
              className="flex items-center justify-center w-full gap-2 px-4 py-2.5 text-sm font-semibold text-stone-50 transition-colors bg-slate-700 rounded-xl hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white shadow-sm"
            >
              <Icon name={primaryAction.icon || "arrow"} size={16} />
              {primaryAction.label}
            </Link>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center justify-center w-full gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors bg-stone-100 border border-stone-200 rounded-xl hover:bg-stone-200/80 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
          >
            <Icon name="logout" size={16} />
            Log out
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="flex items-center justify-between h-16 px-4 bg-white border-b border-stone-200 dark:bg-slate-900 dark:border-slate-800 sm:px-6 lg:px-8 transition-colors">
          <button
            type="button"
            className="p-2 -ml-2 text-slate-600 rounded-lg md:hidden hover:bg-stone-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>

          <div className="items-center hidden text-sm font-medium text-stone-500 dark:text-slate-400 md:flex">
            <span>{roleLabel}</span>
            {active && (
              <>
                <span className="mx-2 text-stone-300 dark:text-slate-700">/</span>
                <strong className="text-slate-900 dark:text-slate-100">{active.label}</strong>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 ml-auto md:ml-0">
            <ThemeToggle />
            <p className="hidden text-sm font-medium text-stone-500 dark:text-slate-400 sm:block">{today}</p>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-auto sm:p-6 lg:p-8 bg-stone-50/70 dark:bg-slate-950 transition-colors">
          {children}
        </main>
      </div>
    </div>
  );
}