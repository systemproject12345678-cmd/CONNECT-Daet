"use client";

import { useState, useMemo } from "react";
import { formatTimeRange, regTypeOf, REG_TYPE_LABEL } from "@/lib/eventSchedule";
import { peso } from "@/lib/eventHelpers";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAYS_LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const OFFICIAL_STATUSES = new Set([
  "approved",
  "upcoming",
  "ongoing",
  "completed",
  "rescheduled",
  "cancellation requested",
]);

const norm = (v) => (typeof v === "string" || typeof v === "number" ? String(v).trim().toLowerCase() : "");

// Parses "YYYY-MM-DD" or ISO timestamps into a local YYYY-MM-DD key without timezone drift.
const toDateKey = (raw) => {
  if (!raw || typeof raw === "function" || typeof raw === "object") return "";
  const str = String(raw).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseDateParts = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
};

const formatReadableDate = (key) => {
  if (!key) return "Select a date";
  const { year, month, day } = parseDateParts(key);
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const formatShortDate = (key) => {
  if (!key) return "TBA";
  const { year, month, day } = parseDateParts(key);
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

// Expands an event across all dates from event_date to event_end_date/end_date (capped at 60 days).
const expandEventDates = (ev) => {
  const startKey = toDateKey(ev.event_date || ev.date);
  if (!startKey) return [];
  const endKey = toDateKey(ev.event_end_date || ev.end_date);
  if (!endKey || endKey <= startKey) return [startKey];

  const s = parseDateParts(startKey);
  const e = parseDateParts(endKey);
  const startObj = new Date(s.year, s.month, s.day);
  const endObj = new Date(e.year, e.month, e.day);

  const keys = [];
  const cursor = new Date(startObj);
  let guard = 0;
  while (cursor <= endObj && guard < 60) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    keys.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
};

// Matches the Admin Dashboard duplicate/conflict rules: same title OR same date + same venue.
const findMatchingConflicts = (targetEvent, allEvents) => {
  if (!targetEvent || !Array.isArray(allEvents)) return [];
  const targetId = String(targetEvent.id);
  const targetName = norm(targetEvent.event_name);
  const targetVenue = norm(targetEvent.venue);
  const targetDates = new Set(expandEventDates(targetEvent));

  return allEvents.filter((other) => {
    if (String(other.id) === targetId) return false;
    const otherStatus = norm(other.status);
    if (otherStatus === "rejected" || otherStatus === "cancelled") return false;

    const otherName = norm(other.event_name);
    const otherVenue = norm(other.venue);
    const otherDates = expandEventDates(other);

    const sameName = Boolean(targetName && otherName && targetName === otherName);
    const sharesDate = otherDates.some((d) => targetDates.has(d));
    const sameVenue = Boolean(targetVenue && otherVenue && targetVenue === otherVenue);

    return sameName || (sharesDate && sameVenue);
  });
};

const statusPillStyle = (status) => {
  switch (norm(status)) {
    case "ongoing":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "approved":
    case "upcoming":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "completed":
      return "bg-slate-200 text-slate-700 border-slate-300";
    case "rescheduled":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "cancellation requested":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "pending":
    case "under review":
    case "requirements needed":
    case "requirements submitted":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "requires changes":
      return "bg-indigo-100 text-indigo-800 border-indigo-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
};

const belongsToOrganizer = (ev, orgProfile) => {
  if (!orgProfile) return false;
  if (ev.organizer_id && orgProfile.id && String(ev.organizer_id) === String(orgProfile.id)) return true;
  const evOrg = norm(ev.organizer_name || ev.organizer);
  const orgName = norm(orgProfile.organization);
  const repName = norm(orgProfile.organizer_full_name || orgProfile.full_name);
  if (orgName && evOrg.includes(orgName)) return true;
  if (repName && evOrg.includes(repName)) return true;
  return false;
};

export default function EventCalendar({
  events = [],
  role = "guest", // "admin" | "organizer" | "tourist" | "guest"
  organizerProfile = null,
  organizerEvents = null, // optional pre-filtered list of the organizer's own events
  onSelectEvent = null,
}) {
  const todayObj = new Date();
  const todayKey = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, "0")}-${String(
    todayObj.getDate()
  ).padStart(2, "0")}`;

  const [selectedYear, setSelectedYear] = useState(todayObj.getFullYear());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState("year"); // "year" | "month"
  const [focusedMonth, setFocusedMonth] = useState(todayObj.getMonth());
  const [organizerScope, setOrganizerScope] = useState("all"); // "all" | "mine"
  const [searchQuery, setSearchQuery] = useState("");

  const ownedIdSet = useMemo(() => {
    if (!Array.isArray(organizerEvents)) return null;
    return new Set(organizerEvents.map((e) => String(e.id)));
  }, [organizerEvents]);

  const isOwnedEvent = (ev) => {
    if (ownedIdSet) return ownedIdSet.has(String(ev.id));
    return belongsToOrganizer(ev, organizerProfile);
  };

  // Filter events according to role and organizer toggle
  const scopedEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sourceList =
      role === "organizer" && organizerScope === "mine" && Array.isArray(organizerEvents)
        ? organizerEvents
        : Array.isArray(events)
        ? events
        : [];

    return sourceList.filter((ev) => {
      const st = norm(ev.status);

      if (role === "organizer" && organizerScope === "mine") {
        if (!ownedIdSet && !belongsToOrganizer(ev, organizerProfile)) return false;
        if (st === "cancelled" || st === "rejected") return false;
      } else {
        // Official events posted in the main programs
        if (!OFFICIAL_STATUSES.has(st)) return false;
      }

      if (q) {
        const hay = [ev.event_name, ev.venue, ev.organizer_name, ev.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [events, organizerEvents, ownedIdSet, role, organizerScope, organizerProfile, searchQuery]);

  // Detect duplicate / same-venue conflicts across scheduled events
  const conflictsByEventId = useMemo(() => {
    const map = new Map();
    scopedEvents.forEach((ev) => {
      const matches = findMatchingConflicts(ev, scopedEvents);
      if (matches.length > 0) map.set(String(ev.id), matches);
    });
    return map;
  }, [scopedEvents]);

  // Group events by YYYY-MM-DD and sort same-day events chronologically
  const eventsByDate = useMemo(() => {
    const map = {};

    scopedEvents.forEach((ev) => {
      const dateKeys = expandEventDates(ev);
      dateKeys.forEach((key, idx) => {
        if (!map[key]) map[key] = [];
        map[key].push({
          ...ev,
          _dayIndex: idx + 1,
          _totalDays: dateKeys.length,
        });
      });
    });

    Object.keys(map).forEach((key) => {
      map[key].sort((a, b) => {
        const tA = a.event_time || "99:99";
        const tB = b.event_time || "99:99";
        if (tA !== tB) return tA.localeCompare(tB);
        return String(a.event_name || "").localeCompare(String(b.event_name || ""));
      });
    });

    return map;
  }, [scopedEvents]);

  // Count total scheduled event occurrences in the selected year
  const yearStats = useMemo(() => {
    const prefix = `${selectedYear}-`;
    const uniqueIds = new Set();
    let busyDays = 0;

    Object.entries(eventsByDate).forEach(([key, list]) => {
      if (key.startsWith(prefix) && list.length > 0) {
        busyDays += 1;
        list.forEach((ev) => uniqueIds.add(ev.id));
      }
    });

    return { totalEvents: uniqueIds.size, busyDays };
  }, [eventsByDate, selectedYear]);

  // Complete organized list of all events occurring inside the focused month
  const focusedMonthSchedule = useMemo(() => {
    const monthPrefix = `${selectedYear}-${String(focusedMonth + 1).padStart(2, "0")}-`;
    const seen = new Map();

    Object.entries(eventsByDate)
      .filter(([key]) => key.startsWith(monthPrefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([dateKey, dayItems]) => {
        dayItems.forEach((ev) => {
          const idKey = String(ev.id);
          if (!seen.has(idKey)) {
            seen.set(idKey, {
              event: ev,
              firstDateInMonth: dateKey,
              lastDateInMonth: dateKey,
              daysInMonthCount: 1,
            });
          } else {
            const entry = seen.get(idKey);
            entry.lastDateInMonth = dateKey;
            entry.daysInMonthCount += 1;
          }
        });
      });

    return Array.from(seen.values()).sort((a, b) => {
      if (a.firstDateInMonth !== b.firstDateInMonth) {
        return a.firstDateInMonth.localeCompare(b.firstDateInMonth);
      }
      const tA = a.event.event_time || "99:99";
      const tB = b.event.event_time || "99:99";
      if (tA !== tB) return tA.localeCompare(tB);
      return String(a.event.event_name || "").localeCompare(String(b.event.event_name || ""));
    });
  }, [eventsByDate, selectedYear, focusedMonth]);

  const selectedDayEvents = eventsByDate[selectedDate] || [];

  const selectedDayConflicts = useMemo(() => {
    if (selectedDayEvents.length < 2) return [];
    const warnings = [];
    const seenNames = new Map();
    const seenVenues = new Map();

    selectedDayEvents.forEach((ev) => {
      const n = norm(ev.event_name);
      const v = norm(ev.venue);
      if (n) {
        if (seenNames.has(n)) {
          warnings.push(`Duplicate event title "${ev.event_name}" scheduled multiple times on this date.`);
        } else {
          seenNames.set(n, ev);
        }
      }
      if (v && v !== "tba") {
        if (seenVenues.has(v)) {
          const prev = seenVenues.get(v);
          warnings.push(`Same venue (${ev.venue}) shared by "${prev.event_name}" and "${ev.event_name}".`);
        } else {
          seenVenues.set(v, ev);
        }
      }
    });

    return [...new Set(warnings)];
  }, [selectedDayEvents]);

  const handleJumpToday = () => {
    const now = new Date();
    setSelectedYear(now.getFullYear());
    setFocusedMonth(now.getMonth());
    setSelectedDate(todayKey);
  };

  const handleSelectDate = (dateKey, monthIdx) => {
    setSelectedDate(dateKey);
    if (typeof monthIdx === "number") setFocusedMonth(monthIdx);
  };

  const syncDateToMonth = (year, monthIdx) => {
    const monthPrefix = `${year}-${String(monthIdx + 1).padStart(2, "0")}-`;
    if (selectedDate && selectedDate.startsWith(monthPrefix)) return;
    const firstBusyKey = Object.keys(eventsByDate)
      .filter((k) => k.startsWith(monthPrefix) && eventsByDate[k].length > 0)
      .sort()[0];
    setSelectedDate(firstBusyKey || `${monthPrefix}01`);
  };

  const openMonthDetail = (monthIdx) => {
    setFocusedMonth(monthIdx);
    setViewMode("month");
    syncDateToMonth(selectedYear, monthIdx);
  };

  const buildMonthCells = (year, monthIdx) => {
    const firstWeekday = new Date(year, monthIdx, 1).getDay();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ day, key, items: eventsByDate[key] || [] });
    }
    return cells;
  };

  return (
    <div className="space-y-6">
      {/* Top Calendar Controls */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Year Navigation & Stats */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center bg-slate-100 rounded-xl p-1 border border-gray-200">
              <button
                type="button"
                onClick={() => setSelectedYear((y) => y - 1)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-white transition-all"
                aria-label="Previous year"
              >
                ←
              </button>
              <span className="px-4 py-1.5 text-sm font-black text-slate-900 tabular-nums">
                {selectedYear}
              </span>
              <button
                type="button"
                onClick={() => setSelectedYear((y) => y + 1)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-white transition-all"
                aria-label="Next year"
              >
                →
              </button>
            </div>

            <button
              type="button"
              onClick={handleJumpToday}
              className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 rounded-xl text-xs font-bold transition-all"
            >
              Today
            </button>

            <div className="text-xs font-semibold text-gray-500 pl-1">
              <strong className="text-slate-900">{yearStats.totalEvents}</strong>{" "}
              {yearStats.totalEvents === 1 ? "event" : "events"} across{" "}
              <strong className="text-slate-900">{yearStats.busyDays}</strong>{" "}
              {yearStats.busyDays === 1 ? "day" : "days"} in {selectedYear}
            </div>
          </div>

          {/* View Mode & Organizer Scope Switcher */}
          <div className="flex flex-wrap items-center gap-2.5">
            {role === "organizer" && (
              <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => setOrganizerScope("all")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    organizerScope === "all"
                      ? "bg-blue-900 text-white shadow-sm"
                      : "text-gray-600 hover:text-slate-900"
                  }`}
                >
                  All Official Events
                </button>
                <button
                  type="button"
                  onClick={() => setOrganizerScope("mine")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    organizerScope === "mine"
                      ? "bg-blue-900 text-white shadow-sm"
                      : "text-gray-600 hover:text-slate-900"
                  }`}
                >
                  My Events Only
                </button>
              </div>
            )}

            <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-gray-200">
              <button
                type="button"
                onClick={() => setViewMode("year")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "year"
                    ? "bg-white text-blue-900 shadow-sm"
                    : "text-gray-600 hover:text-slate-900"
                }`}
              >
                1-Year Overview
              </button>
              <button
                type="button"
                onClick={() => openMonthDetail(focusedMonth)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "month"
                    ? "bg-white text-blue-900 shadow-sm"
                    : "text-gray-600 hover:text-slate-900"
                }`}
              >
                Monthly Detail
              </button>
            </div>
          </div>
        </div>

        {/* Search + Legend */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter calendar by event name, venue, or organizer..."
            className="w-full sm:max-w-sm px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
          />

          <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md bg-blue-600 inline-block" />
              Single event
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md bg-amber-400 border border-amber-500 inline-block" />
              Multiple events on same day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md ring-2 ring-slate-900 bg-white inline-block" />
              Selected date
            </span>
          </div>
        </div>
      </div>

      {/* Main Split Layout: Calendar Grid + Selected Day Multi-Event Agenda */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 1-Year 12-Month Grid OR Expanded Month Grid + Full Monthly Event List */}
        <div className="lg:col-span-8 space-y-6">
          {viewMode === "year" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {MONTHS.map((monthName, monthIdx) => {
                const cells = buildMonthCells(selectedYear, monthIdx);
                const monthEventCount = cells.reduce(
                  (sum, c) => sum + (c ? c.items.length : 0),
                  0
                );

                return (
                  <div
                    key={monthName}
                    className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-gray-100">
                        <button
                          type="button"
                          onClick={() => openMonthDetail(monthIdx)}
                          className="text-sm font-black text-slate-900 hover:text-blue-700 transition-colors"
                          title={`Open complete ${monthName} ${selectedYear} view`}
                        >
                          {monthName}
                        </button>
                        <button
                          type="button"
                          onClick={() => openMonthDetail(monthIdx)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                            monthEventCount > 0
                              ? "bg-blue-50 hover:bg-blue-100 text-blue-900"
                              : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                          }`}
                        >
                          {monthEventCount > 0
                            ? `${monthEventCount} ${monthEventCount === 1 ? "event" : "events"}`
                            : "View month"}
                        </button>
                      </div>

                      <div className="grid grid-cols-7 gap-1 text-center mb-1">
                        {WEEKDAYS_SHORT.map((w, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-bold text-gray-400 py-0.5"
                          >
                            {w}
                          </span>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1">
                        {cells.map((cell, idx) => {
                          if (!cell) {
                            return <div key={`empty-${idx}`} className="h-8" />;
                          }

                          const count = cell.items.length;
                          const isSelected = cell.key === selectedDate;
                          const isToday = cell.key === todayKey;

                          let cellTone = "text-gray-700 hover:bg-gray-100";
                          if (count === 1) {
                            cellTone = "bg-blue-600 text-white font-bold hover:bg-blue-700";
                          } else if (count > 1) {
                            cellTone =
                              "bg-amber-400 text-slate-950 font-black hover:bg-amber-500";
                          } else if (isToday) {
                            cellTone = "bg-slate-100 text-blue-900 font-bold";
                          }

                          return (
                            <button
                              key={cell.key}
                              type="button"
                              onClick={() => handleSelectDate(cell.key, monthIdx)}
                              title={
                                count > 0
                                  ? `${cell.key}: ${count} event${count > 1 ? "s" : ""}`
                                  : cell.key
                              }
                              className={`relative h-8 rounded-lg text-[11px] flex items-center justify-center transition-all ${cellTone} ${
                                isSelected ? "ring-2 ring-slate-900 ring-offset-1" : ""
                              }`}
                            >
                              <span>{cell.day}</span>
                              {count > 1 && (
                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-slate-900 text-white text-[9px] font-black leading-[14px] text-center">
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Expanded Complete Month Grid */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMode("year")}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-all"
                    >
                      ← All Months
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextYear = focusedMonth === 0 ? selectedYear - 1 : selectedYear;
                        const nextMonth = focusedMonth === 0 ? 11 : focusedMonth - 1;
                        setSelectedYear(nextYear);
                        setFocusedMonth(nextMonth);
                        syncDateToMonth(nextYear, nextMonth);
                      }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-slate-700"
                    >
                      ← Prev
                    </button>
                    <h3 className="text-base font-black text-slate-900 px-2">
                      {MONTHS[focusedMonth]} {selectedYear}
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        const nextYear = focusedMonth === 11 ? selectedYear + 1 : selectedYear;
                        const nextMonth = focusedMonth === 11 ? 0 : focusedMonth + 1;
                        setSelectedYear(nextYear);
                        setFocusedMonth(nextMonth);
                        syncDateToMonth(nextYear, nextMonth);
                      }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-slate-700"
                    >
                      Next →
                    </button>
                  </div>

                  <select
                    value={focusedMonth}
                    onChange={(e) => {
                      const nextMonth = Number(e.target.value);
                      setFocusedMonth(nextMonth);
                      syncDateToMonth(selectedYear, nextMonth);
                    }}
                    className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 bg-white"
                    aria-label="Jump to month"
                  >
                    {MONTHS.map((m, idx) => (
                      <option key={m} value={idx}>
                        {m} {selectedYear}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-7 gap-1.5 text-center">
                  {WEEKDAYS_LONG.map((w) => (
                    <div key={w} className="text-[11px] font-bold text-gray-500 py-1">
                      {w}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1.5">
                  {buildMonthCells(selectedYear, focusedMonth).map((cell, idx) => {
                    if (!cell) {
                      return (
                        <div
                          key={`m-empty-${idx}`}
                          className="min-h-[96px] rounded-xl bg-gray-50/60 border border-transparent"
                        />
                      );
                    }

                    const count = cell.items.length;
                    const isSelected = cell.key === selectedDate;
                    const isToday = cell.key === todayKey;

                    return (
                      <div
                        key={cell.key}
                        onClick={() => handleSelectDate(cell.key, focusedMonth)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") handleSelectDate(cell.key, focusedMonth);
                        }}
                        className={`min-h-[96px] p-1.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                          isSelected
                            ? "border-slate-900 bg-blue-50/40 ring-2 ring-slate-900/20"
                            : count > 1
                            ? "border-amber-300 bg-amber-50/30 hover:border-amber-500"
                            : count === 1
                            ? "border-blue-200 bg-white hover:border-blue-400"
                            : "border-gray-100 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                              isToday ? "bg-blue-900 text-white" : "text-slate-700"
                            }`}
                          >
                            {cell.day}
                          </span>
                          {count > 1 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black">
                              {count} events
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 overflow-hidden">
                          {cell.items.slice(0, 2).map((ev) => (
                            <div
                              key={`${ev.id}-${cell.key}`}
                              className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-950 text-[10px] font-bold truncate"
                              title={`${ev.event_name}${formatTimeRange(ev) ? ` (${formatTimeRange(ev)})` : ""}`}
                            >
                              {ev.event_name}
                            </div>
                          ))}
                          {count > 2 && (
                            <div className="text-[10px] font-black text-blue-700 pl-1">
                              +{count - 2} more...
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Complete Organized List of All Events in the Clicked Month */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      All Events in {MONTHS[focusedMonth]} {selectedYear}
                    </h3>
                    <p className="text-xs text-gray-500 font-semibold mt-0.5">
                      Complete chronological directory of scheduled programs for this month
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-900 text-xs font-black">
                    {focusedMonthSchedule.length}{" "}
                    {focusedMonthSchedule.length === 1 ? "event" : "events"}
                  </span>
                </div>

                {focusedMonthSchedule.length === 0 ? (
                  <div className="p-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center space-y-1">
                    <p className="text-xs font-bold text-gray-500">
                      No events scheduled in {MONTHS[focusedMonth]} {selectedYear}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      Use Previous/Next or switch back to the 1-Year Overview to browse other months.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                    {focusedMonthSchedule.map(({ event: ev, firstDateInMonth, lastDateInMonth, daysInMonthCount }, idx) => {
                      const timeText = formatTimeRange(ev);
                      const isMine = role === "organizer" && isOwnedEvent(ev);
                      const conflictMatches = conflictsByEventId.get(String(ev.id)) || [];
                      const isSelectedDay =
                        selectedDate >= firstDateInMonth && selectedDate <= lastDateInMonth;

                      return (
                        <div
                          key={`${ev.id}-${firstDateInMonth}`}
                          className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                            isSelectedDay ? "bg-blue-50/50" : "bg-white hover:bg-gray-50"
                          }`}
                        >
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-black">
                                #{idx + 1}
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-950 text-[10px] font-black">
                                {daysInMonthCount > 1
                                  ? `${formatShortDate(firstDateInMonth)} – ${formatShortDate(lastDateInMonth)}`
                                  : formatShortDate(firstDateInMonth)}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusPillStyle(
                                  ev.status
                                )}`}
                              >
                                {ev.status || "Official"}
                              </span>
                              {isMine && organizerScope === "all" && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                                  Your Event
                                </span>
                              )}
                              {conflictMatches.length > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                                  Matching Event Warning
                                </span>
                              )}
                            </div>

                            <h4 className="text-sm font-black text-slate-900">{ev.event_name}</h4>

                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 font-medium">
                              <span>
                                <strong>Time:</strong> {timeText || "Time TBA"}
                              </span>
                              <span>
                                <strong>Venue:</strong> {ev.venue || "TBA"}
                              </span>
                              <span>
                                <strong>Organizer:</strong> {ev.organizer_name || "Municipal Tourism"}
                              </span>
                              <span>
                                <strong>Fee:</strong> {ev.is_paid ? peso(ev.fee_amount) : "Free"}
                              </span>
                            </div>
                          </div>

                          <div className="flex sm:flex-col items-stretch gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => handleSelectDate(firstDateInMonth, focusedMonth)}
                              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
                            >
                              Focus Day
                            </button>
                            {typeof onSelectEvent === "function" && (
                              <button
                                type="button"
                                onClick={() => onSelectEvent(ev)}
                                className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all whitespace-nowrap"
                              >
                                View Details
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Column: Sticky Day Schedule & Same-Day Event List */}
        <div className="lg:col-span-4 lg:sticky lg:top-24 bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
          <div className="border-b border-gray-100 pb-3">
            <div className="flex items-center justify-between gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-black uppercase">
                {role === "organizer" && organizerScope === "mine"
                  ? "My Event Schedule"
                  : "Official Schedule"}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                  selectedDayEvents.length > 1
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {selectedDayEvents.length}{" "}
                {selectedDayEvents.length === 1 ? "event" : "events"}
              </span>
            </div>
            <h3 className="text-base font-black text-slate-900 mt-2">
              {formatReadableDate(selectedDate)}
            </h3>
          </div>

          {selectedDayEvents.length > 1 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                Multiple Official Events Scheduled ({selectedDayEvents.length})
              </p>
              <p className="font-medium leading-snug">
                This date has {selectedDayEvents.length} scheduled events listed chronologically below.
              </p>
              {selectedDayConflicts.map((warn, i) => (
                <p key={i} className="text-[11px] font-bold text-red-700 pt-1">
                  Warning: {warn}
                </p>
              ))}
            </div>
          )}

          {selectedDayEvents.length === 0 ? (
            <div className="p-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center space-y-1">
              <p className="text-xs font-bold text-gray-500">No events scheduled on this date</p>
              <p className="text-[11px] text-gray-400">
                Select any highlighted date on the calendar to view its full schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {selectedDayEvents.map((ev, idx) => {
                const timeText = formatTimeRange(ev);
                const isMine = role === "organizer" && isOwnedEvent(ev);
                const conflictMatches = conflictsByEventId.get(String(ev.id)) || [];

                return (
                  <div
                    key={`${ev.id}-${selectedDate}-${idx}`}
                    className={`p-4 rounded-xl border transition-all space-y-2 ${
                      conflictMatches.length > 0
                        ? "border-amber-300 bg-amber-50/40 hover:bg-white"
                        : "border-gray-200 bg-gray-50/70 hover:bg-white hover:border-blue-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-bold">
                          #{idx + 1}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusPillStyle(
                            ev.status
                          )}`}
                        >
                          {ev.status || "Official"}
                        </span>
                        {isMine && organizerScope === "all" && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                            Your Event
                          </span>
                        )}
                        {conflictMatches.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                            Duplicate / Venue Conflict
                          </span>
                        )}
                      </div>

                      {ev._totalDays > 1 && (
                        <span className="text-[10px] font-bold text-blue-700 whitespace-nowrap">
                          Day {ev._dayIndex} of {ev._totalDays}
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-black text-slate-900 leading-snug">
                      {ev.event_name}
                    </h4>

                    <div className="text-xs text-gray-600 space-y-1 font-medium">
                      <p>
                        <strong>Time:</strong> {timeText || "Time TBA"}
                      </p>
                      <p>
                        <strong>Venue:</strong> {ev.venue || "TBA"}
                      </p>
                      <p>
                        <strong>Organizer:</strong> {ev.organizer_name || "Municipal Tourism"}
                      </p>
                      <p>
                        <strong>Type & Fee:</strong> {REG_TYPE_LABEL[regTypeOf(ev)]} ·{" "}
                        {ev.is_paid ? peso(ev.fee_amount) : "Free"}
                      </p>
                    </div>

                    {typeof onSelectEvent === "function" && (
                      <button
                        type="button"
                        onClick={() => onSelectEvent(ev)}
                        className="w-full mt-1 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all"
                      >
                        View Event Details
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}