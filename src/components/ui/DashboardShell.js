"use client";

import { useState } from "react";
import Link from "next/link";

// Small stroke icon set (24x24).
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

// Five-point star taken from the Rizal monument in Daet.
export function StarMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points="12,2.5 14.9,9 22,9.6 16.6,14.3 18.2,21.2 12,17.5 5.8,21.2 7.4,14.3 2,9.6 9.1,9"
        fill="#f2b53b"
      />
    </svg>
  );
}

/**
 * Shared layout for the admin, organizer and tourist dashboards.
 *
 * nav: [{ key, label, icon, badge?, tone?: "amber" | "red" | "blue" }]
 * primaryAction: { label, href, icon? }
 */
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
    <div className="flex h-[calc(100vh-4rem)] bg-gray-50 text-gray-900 font-sans overflow-hidden">
      
      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label={`${roleLabel} navigation`}
      >
        <div className="p-6 border-b border-gray-100">
          <p className="text-xs font-semibold tracking-wider text-gray-500 uppercase">{roleLabel}</p>
          <p className="mt-1 text-lg font-bold text-gray-900 truncate">{name}</p>
          {subtitle && <p className="text-sm text-gray-500 truncate">{subtitle}</p>}
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
                className={`flex items-center w-full px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon name={item.icon} className={isActive ? "text-blue-700" : "text-gray-400"} />
                <span className="flex-1 ml-3 text-left">{item.label}</span>
                {item.badge > 0 && (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 ml-auto text-xs font-medium rounded-full ${
                      item.tone === "red"
                        ? "bg-red-100 text-red-800"
                        : item.tone === "blue"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer (Actions) */}
        <div className="p-4 space-y-3 border-t border-gray-100">
          {primaryAction && (
            <Link
              href={primaryAction.href}
              className="flex items-center justify-center w-full gap-2 px-4 py-2.5 text-sm font-medium text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
            >
              <Icon name={primaryAction.icon || "arrow"} size={16} />
              {primaryAction.label}
            </Link>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center justify-center w-full gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            <Icon name="logout" size={16} />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile Scrim Background */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-gray-900/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        
        {/* Top Header */}
        <header className="flex items-center justify-between h-16 px-4 bg-white border-b border-gray-200 sm:px-6 lg:px-8">
          <button
            type="button"
            className="p-2 -ml-2 text-gray-500 rounded-md md:hidden hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>
          
          <div className="items-center hidden text-sm font-medium text-gray-500 md:flex">
            <span>{roleLabel}</span>
            {active && (
              <>
                <span className="mx-2 text-gray-300">/</span>
                <strong className="text-gray-900">{active.label}</strong>
              </>
            )}
          </div>
          
          <p className="ml-auto text-sm font-medium text-gray-500 md:ml-0">{today}</p>
        </header>

        {/* Dynamic Content Injection */}
        <main className="flex-1 p-4 overflow-auto sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}