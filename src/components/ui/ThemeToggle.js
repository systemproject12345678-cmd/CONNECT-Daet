"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle({ className = "" }) {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("connect_daet_theme");
    const isDark = savedTheme === "dark";
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const handleToggle = () => {
    const nextMode = !darkMode;
    setDarkMode(nextMode);
    document.documentElement.classList.toggle("dark", nextMode);
    localStorage.setItem("connect_daet_theme", nextMode ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="Toggle dark mode"
      className={`inline-flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors bg-stone-100 hover:bg-stone-200 text-slate-700 border-stone-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 ${className}`}
    >
      <span>{darkMode ? "Light Mode" : "Dark Mode"}</span>
      <span className="text-sm leading-none">{darkMode ? "☀️" : "🌙"}</span>
    </button>
  );
}