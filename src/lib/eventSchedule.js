// Shared schedule helpers. Event status (Upcoming / Ongoing / Completed) is derived
// from the date and time the organizer set in the proposal, so nobody has to press buttons.
import { useEffect, useState } from "react";

const norm = (s) => (s || "").toString().trim().toLowerCase();

// Statuses that mean "approved by the Tourism Office" - only these follow the clock.
const CLOCK_DRIVEN = ["approved", "upcoming", "ongoing", "completed"];

// Accepts "14:30", "14:30:00" (Supabase time column) and "2:30 PM" (older free-text values).
export function parseTime(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3] ? m[3].toLowerCase() : null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

export function formatTime(value) {
  const t = parseTime(value);
  if (!t) return value ? String(value) : "";
  const d = new Date(2000, 0, 1, t.h, t.m);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatTimeRange(event) {
  const start = formatTime(event?.event_time);
  const end = formatTime(event?.event_end_time);
  if (start && end) return `${start} - ${end}`;
  return start || "";
}

// Returns { start: Date, end: Date } or null when the event has no usable date.
export function getEventWindow(event) {
  const raw = event?.event_date || event?.date;
  if (!raw) return null;
  const dm = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return null;
  const y = parseInt(dm[1], 10);
  const mo = parseInt(dm[2], 10) - 1;
  const d = parseInt(dm[3], 10);

  const st = parseTime(event.event_time) || { h: 0, m: 0 };
  const start = new Date(y, mo, d, st.h, st.m, 0, 0);

  const en = parseTime(event.event_end_time);
  let end;
  if (en) {
    end = new Date(y, mo, d, en.h, en.m, 0, 0);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000); // runs past midnight
  } else {
    end = new Date(y, mo, d, 23, 59, 59, 999); // no end time: the event lasts until the end of that day
  }
  return { start, end };
}

// "Upcoming" | "Ongoing" | "Completed" for approved events, otherwise the stored status unchanged.
export function getLiveStatus(event, now = new Date()) {
  const stored = event?.status;
  if (!CLOCK_DRIVEN.includes(norm(stored))) return stored;
  const win = getEventWindow(event);
  if (!win) return stored;
  if (now >= win.end) return "Completed";
  if (now >= win.start) return "Ongoing";
  return "Upcoming";
}

export function withLiveStatus(event, now = new Date()) {
  if (!event) return event;
  const status = getLiveStatus(event, now);
  return status === event.status ? event : { ...event, status };
}

// Re-renders the component every `ms` so statuses flip on time without a page refresh.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ---- "Interested" events: stored in the browser, no database table needed ----
const interestKey = (userId) => `daet:interested:${userId}`;

export function loadInterested(userId) {
  if (!userId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(interestKey(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveInterested(userId, ids) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(interestKey(userId), JSON.stringify([...new Set(ids.map(String))]));
  } catch {
    /* storage full or blocked - interest simply won't persist */
  }
}

// Milliseconds until the event starts (negative once it has started), or null with no date.
export function msUntilStart(event, now = new Date()) {
  const win = getEventWindow(event);
  return win ? win.start.getTime() - now.getTime() : null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Registration type: "single" (default), "group" (teams) or "interested" (publication only) ----
export const regTypeOf = (event) => {
  const t = String(event?.registration_type || "").trim().toLowerCase();
  return t === "group" || t === "interested" ? t : "single";
};

export const REG_TYPE_LABEL = {
  single: "Single registration",
  group: "Group registration",
  interested: "Interested only",
};

// team_members is a jsonb array; be forgiving if it arrives as a JSON string.
export const teamMembersOf = (reg) => {
  const raw = reg?.team_members;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};