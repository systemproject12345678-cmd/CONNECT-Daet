"use client";

import { useEffect, useRef, useState } from "react";

// Wheel-style time picker (hour : minute AM/PM with Cancel / Save).
// value / onChange use 24-hour "HH:MM" strings, which is what the database stores.

const ITEM_H = 40;
const ROWS = 5;
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ["AM", "PM"];
const pad = (n) => String(n).padStart(2, "0");

function parse24(value) {
  // Accepts "14:30", "14:30:00" and older free-text values such as "2:30 PM".
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h24 = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const suffix = m[3] ? m[3].toLowerCase() : null;
  if (suffix === "pm" && h24 < 12) h24 += 12;
  if (suffix === "am" && h24 === 12) h24 = 0;
  if (h24 > 23 || min > 59) return null;
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, m: min, p: h24 >= 12 ? "PM" : "AM" };
}

function to24({ h, m, p }) {
  let h24 = h % 12;
  if (p === "PM") h24 += 12;
  return `${pad(h24)}:${pad(m)}`;
}

export function formatDisplay(value) {
  const t = parse24(value);
  return t ? `${t.h}:${pad(t.m)} ${t.p}` : "";
}

function Wheel({ items, index, onChange, format, width = 72, label }) {
  const ref = useRef(null);

  // Keep the wheel in sync when the selected index changes from outside (opening, typing, etc.).
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ITEM_H) !== index) el.scrollTop = index * ITEM_H;
  }, [index]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
    if (i !== index) onChange(i);
  };

  return (
    <div className="relative" style={{ height: ITEM_H * ROWS, width }} role="listbox" aria-label={label}>
      <div
        ref={ref}
        onScroll={handleScroll}
        className="daet-wheel h-full overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div style={{ height: ITEM_H * 2 }} />
        {items.map((item, i) => {
          const distance = Math.abs(i - index);
          return (
            <button
              key={String(item)}
              type="button"
              role="option"
              aria-selected={i === index}
              onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" })}
              style={{ height: ITEM_H }}
              className={`snap-center w-full flex items-center justify-center tabular-nums transition-colors ${
                distance === 0 ? "text-base font-bold text-slate-900" : distance === 1 ? "text-sm text-gray-400" : "text-sm text-gray-300"
              }`}
            >
              {format(item)}
            </button>
          );
        })}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
    </div>
  );
}

export default function TimePicker({ label, value, onChange, optional = false, required = false, placeholder = "Select time" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ h: 9, m: 0, p: "AM" });
  const wrapRef = useRef(null);

  const openPicker = () => {
    setDraft(parse24(value) || { h: 9, m: 0, p: "AM" });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const display = formatDisplay(value);

  return (
    <div ref={wrapRef} className="relative">
      {label && (
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          {label}
          {required ? " *" : ""}
          {optional ? " (optional)" : ""}
        </label>
      )}

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className={display ? "text-gray-700 font-semibold" : "text-gray-400"}>{display || placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>

      {optional && value && (
        <button type="button" onClick={() => onChange("")} className="mt-1 text-[11px] font-bold text-gray-400 hover:text-red-600">
          Clear time
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Select time" className="absolute left-0 top-full mt-2 z-50 w-72 max-w-[85vw] bg-white rounded-2xl border border-gray-200 shadow-xl p-4">
          <style>{`.daet-wheel::-webkit-scrollbar{display:none}`}</style>
          <p className="text-center text-sm font-bold text-slate-900 mb-2">Select time</p>

          <div className="relative flex items-center justify-center" style={{ height: ITEM_H * ROWS }}>
            {/* highlight bar behind the selected row */}
            <div className="absolute left-1 right-1 rounded-lg bg-gray-100 pointer-events-none" style={{ height: ITEM_H, top: ITEM_H * 2 }} />
            <div className="relative flex items-center justify-center">
              <Wheel label="Hour" items={HOURS} index={draft.h - 1} onChange={(i) => setDraft((d) => ({ ...d, h: HOURS[i] }))} format={pad} width={64} />
              <span className="text-base font-bold text-slate-900 -mx-1 z-10">:</span>
              <Wheel label="Minute" items={MINUTES} index={draft.m} onChange={(i) => setDraft((d) => ({ ...d, m: MINUTES[i] }))} format={pad} width={64} />
              <Wheel label="AM or PM" items={PERIODS} index={PERIODS.indexOf(draft.p)} onChange={(i) => setDraft((d) => ({ ...d, p: PERIODS[i] }))} format={(x) => x} width={64} />
            </div>
            {/* fade top and bottom */}
            <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-white to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          </div>

          <div className="flex items-center justify-center gap-6 pt-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold text-gray-700 hover:text-slate-900">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(to24(draft));
                setOpen(false);
              }}
              className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}