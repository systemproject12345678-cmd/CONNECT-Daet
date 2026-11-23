"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";
import DashboardShell from "@/components/ui/DashboardShell";
import { AttachmentList, FilePicker } from "@/components/ui/Attachments";
import { ImageCarousel } from "@/components/ui/ImageCarousel";
import { uploadAttachments, validateFiles, peso, regState, getImageList } from "@/lib/eventHelpers";
import { withLiveStatus, useNow, formatTimeRange, regTypeOf, REG_TYPE_LABEL, teamMembersOf } from "@/lib/eventSchedule";
import TimePicker from "@/components/ui/TimePicker";
import EventCalendar from "@/components/ui/EventCalendar";

const EVENT_THUMB =
  "relative w-full md:w-56 h-44 md:h-40 flex-shrink-0 self-start rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 group";

const REG_OVERRIDE_STORAGE_KEY = "daet_organizer_reg_overrides_v1";
const EVENT_OVERRIDE_STORAGE_KEY = "daet_event_action_overrides_v1";

const norm = (v) => (typeof v === "string" || typeof v === "number" ? String(v).trim().toLowerCase() : "");

const toEventDateKey = (raw) => {
  if (!raw || typeof raw === "function" || typeof raw === "object") return "";
  const match = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const parseEventActionMeta = (ev) => {
  if (!ev) return {};
  const raw = String(ev.rejection_reason || "");
  const contactMatch = raw.match(/\[CONTACT:\s*([^\]]+)\]/i);
  const reschedMatch = raw.match(/\[RESCHEDULE:\s*([^\]]+)\]/i);
  const cleanReason = raw
    .replace(/\[CONTACT:\s*[^\]]+\]/gi, "")
    .replace(/\[RESCHEDULE:\s*[^\]]+\]/gi, "")
    .trim();

  const parsedSchedule = {};
  if (reschedMatch && reschedMatch[1]) {
    const parts = reschedMatch[1].split("|").map((p) => p.trim());
    parts.forEach((part) => {
      if (part.startsWith("date=")) parsedSchedule.reschedule_date = part.slice(5);
      if (part.startsWith("end_date=")) parsedSchedule.reschedule_end_date = part.slice(9);
      if (part.startsWith("time=")) parsedSchedule.reschedule_time = part.slice(5);
      if (part.startsWith("end_time=")) parsedSchedule.reschedule_end_time = part.slice(9);
    });
  }

  return {
    organizer_contact_info:
      ev.organizer_contact_info || (contactMatch ? contactMatch[1].trim() : ""),
    reschedule_date: ev.reschedule_date || parsedSchedule.reschedule_date || "",
    reschedule_end_date: ev.reschedule_end_date || parsedSchedule.reschedule_end_date || "",
    reschedule_time: ev.reschedule_time || parsedSchedule.reschedule_time || "",
    reschedule_end_time: ev.reschedule_end_time || parsedSchedule.reschedule_end_time || "",
    action_reason: ev.reschedule_reason || cleanReason,
  };
};

const buildFallbackReasonText = ({ reason, contactInfo, reschedule }) => {
  const segments = [String(reason || "").trim()];
  if (reschedule && reschedule.date) {
    const rParts = [`date=${reschedule.date}`];
    if (reschedule.endDate) rParts.push(`end_date=${reschedule.endDate}`);
    if (reschedule.time) rParts.push(`time=${reschedule.time}`);
    if (reschedule.endTime) rParts.push(`end_time=${reschedule.endTime}`);
    segments.push(`[RESCHEDULE: ${rParts.join(" | ")}]`);
  }
  if (contactInfo && contactInfo.trim()) {
    segments.push(`[CONTACT: ${contactInfo.trim()}]`);
  }
  return segments.filter(Boolean).join(" ");
};

const findDuplicateEvents = (targetEvent, allEvents) => {
  if (!targetEvent || !Array.isArray(allEvents)) return [];
  const targetId = String(targetEvent.id);
  const targetName = norm(targetEvent.event_name);
  const targetDate = toEventDateKey(targetEvent.event_date || targetEvent.date);
  const targetVenue = norm(targetEvent.venue);

  return allEvents.filter((other) => {
    if (String(other.id) === targetId) return false;
    const otherStatus = norm(other.status);
    if (otherStatus === "rejected" || otherStatus === "cancelled") return false;

    const otherName = norm(other.event_name);
    const otherDate = toEventDateKey(other.event_date || other.date);
    const otherVenue = norm(other.venue);

    const sameName = Boolean(targetName && otherName && targetName === otherName);
    const sameDate = Boolean(targetDate && otherDate && targetDate === otherDate);
    const sameVenue = Boolean(targetVenue && otherVenue && targetVenue === otherVenue);

    return sameName || (sameDate && sameVenue);
  });
};

const resolveRegistrationSerial = (r) => {
  if (!r) return "";
  if (r.serial_id) return String(r.serial_id).trim().toUpperCase();
  if (r.ticket_serial) return String(r.ticket_serial).trim().toUpperCase();
  if (r.serial_number) return String(r.serial_number).trim().toUpperCase();
  if ((regState(r) === "confirmed" || norm(r.refund_status) === "refunded") && r.id != null) {
    const evPart = String(r.event_id || "0").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "EV";
    const idPart = String(r.id).replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase().padStart(6, "0");
    return `DAET-${evPart}-${idPart}`;
  }
  return "";
};

const resolveRefundState = (r) => {
  if (!r) return "none";
  const raw = norm(r.refund_status);
  const regRaw = norm(r.registration_status);
  if (raw === "refunded" || regRaw === "refunded" || r.refund_confirmed === true || Boolean(r.refunded_at)) {
    return "refunded";
  }
  if (raw === "requested" || raw === "refund requested" || regRaw === "refund requested") {
    return "requested";
  }
  if (raw === "declined" || raw === "rejected") {
    return "declined";
  }
  return "none";
};

const resolveAttendanceState = (r) => {
  if (!r) return "unmarked";
  const raw = norm(r.attendance_status);
  if (
    raw === "confirmed" ||
    raw === "present" ||
    r.attendance_confirmed === true ||
    r.organizer_confirmed_attendance === true
  ) {
    return "confirmed";
  }
  if (
    raw === "marked" ||
    raw === "checked_in" ||
    raw === "pending_confirmation" ||
    r.tourist_checked_in === true ||
    Boolean(r.checked_in_at)
  ) {
    return "marked";
  }
  return "unmarked";
};

const attendanceBadgeMeta = (attendance) => {
  if (attendance === "confirmed") {
    return {
      label: "Present (Confirmed)",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-200/80",
    };
  }
  if (attendance === "marked") {
    return {
      label: "Tourist Checked In",
      cls: "bg-amber-50 text-amber-800 border border-amber-300/80",
    };
  }
  return {
    label: "Not Checked In",
    cls: "bg-slate-100 text-slate-600 border border-slate-200/80",
  };
};

const isMissingColumnError = (err) => {
  const msg = norm(err?.message || "");
  const code = String(err?.code || "");
  return code === "PGRST204" || msg.includes("column") || msg.includes("schema cache");
};

const getImageUrl = (urlField) => {
  if (!urlField) return "";
  if (typeof urlField === "string") {
    if (urlField.startsWith("[")) {
      try {
        const parsed = JSON.parse(urlField);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
      } catch (e) {}
    }
    return urlField;
  }
  if (Array.isArray(urlField) && urlField.length > 0) {
    return urlField[0];
  }
  return "";
};

const statusBadge = (status) => {
  switch ((status || "").toLowerCase()) {
    case "approved":
    case "upcoming":
      return "bg-blue-50 text-blue-800 border border-blue-200/70";
    case "ongoing":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200/70";
    case "completed":
      return "bg-slate-100 text-slate-700 border border-slate-200";
    case "rejected":
      return "bg-red-50 text-red-700 border border-red-200/70";
    case "requires changes":
      return "bg-indigo-50 text-indigo-800 border border-indigo-200/70";
    case "requirements needed":
      return "bg-teal-50 text-teal-800 border border-teal-200/70";
    case "requirements submitted":
      return "bg-cyan-50 text-cyan-800 border border-cyan-200/70";
    case "cancelled":
      return "bg-slate-200 text-slate-700 border border-slate-300";
    case "cancellation requested":
      return "bg-orange-50 text-orange-800 border border-orange-200/70";
    case "reschedule requested":
      return "bg-amber-50 text-amber-800 border border-amber-300/80";
    case "rescheduled":
      return "bg-indigo-50 text-indigo-800 border border-indigo-200/80";
    default:
      return "bg-amber-50 text-amber-800 border border-amber-200/70";
  }
};

function TeamDetails({ registration, onPreview }) {
  const members = teamMembersOf(registration);
  const [showMembers, setShowMembers] = useState(true);
  const serialId = resolveRegistrationSerial(registration);

  if (!registration) return null;

  return (
    <div className="space-y-4 text-xs font-semibold">
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-black text-sm text-slate-900">{registration.team_name || "Team Details"}</h4>
            {serialId && (
              <span className="px-2.5 py-0.5 rounded-full bg-blue-900 text-white font-mono text-[10px] font-bold">
                Serial: {serialId}
              </span>
            )}
          </div>
          <p className="text-slate-500 mt-0.5">
            Registered by <strong className="text-slate-700">{registration.first_name} {registration.last_name}</strong> • {members.length} members • {new Date(registration.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowMembers(!showMembers)}
          className="text-blue-900 hover:underline font-bold text-xs"
        >
          {showMembers ? "Hide members ▲" : "Show members ▼"}
        </button>
      </div>

      <div className="bg-slate-50/70 border border-slate-200/70 rounded-2xl p-4 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Team leader contact</span>
            <span className="text-slate-900 font-bold">{registration.email || "-"} • {registration.phone_number || "-"}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Leader address</span>
            <span className="text-slate-900 font-bold">{registration.home_address || "-"}</span>
          </div>
        </div>
      </div>

      {showMembers && (
        <div className="space-y-3 pt-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Team Member Roster</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {members.map((m, idx) => {
              const isLeader = idx === 0;
              return (
                <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2 flex flex-col justify-between">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h5 className="font-black text-slate-900 text-sm flex flex-wrap items-center gap-2">
                        {m.first_name} {m.last_name}
                        {isLeader && (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200/60 rounded-full text-[9px] font-black uppercase">
                            Leader
                          </span>
                        )}
                        {serialId && (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-mono text-[10px] font-bold">
                            {serialId}-{idx + 1}
                          </span>
                        )}
                      </h5>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        {m.gender || "N/A"} • {m.age ? `${m.age} yrs` : ""} {m.civil_status ? `• ${m.civil_status}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-2 space-y-1 text-[11px] text-slate-600">
                    {m.home_address && <p className="truncate" title={m.home_address}>📍 {m.home_address}</p>}
                    {m.phone_number && <p>📞 {m.phone_number}</p>}
                    {m.email && <p className="truncate">✉️ {m.email}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrganizerDashboardPage() {
  const router = useRouter();
  const { notify, confirm: askConfirm, feedbackUI } = useFeedback();
  const [pwSaved, setPwSaved] = useState(false);

  const [activeTab, setActiveTab] = useState("overview");

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [rawEvents, setEvents] = useState([]);
  const [rawAllEvents, setAllEvents] = useState([]);
  const [eventOverrides, setEventOverrides] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem(EVENT_OVERRIDE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const now = useNow(30000);
  const events = useMemo(
    () =>
      rawEvents.map((e) => {
        const ov = eventOverrides[String(e.id)];
        return withLiveStatus(ov ? { ...e, ...ov } : e, now);
      }),
    [rawEvents, eventOverrides, now]
  );
  const allEvents = useMemo(
    () =>
      rawAllEvents.map((e) => {
        const ov = eventOverrides[String(e.id)];
        return withLiveStatus(ov ? { ...e, ...ov } : e, now);
      }),
    [rawAllEvents, eventOverrides, now]
  );

  const [rawAttendees, setAttendees] = useState([]);
  const [regOverrides, setRegOverrides] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem(REG_OVERRIDE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const attendees = useMemo(
    () =>
      rawAttendees.map((a) => {
        const ov = regOverrides[String(a.id)];
        return ov ? { ...a, ...ov } : a;
      }),
    [rawAttendees, regOverrides]
  );
  const [interestedByEvent, setInterestedByEvent] = useState({});
  const [viewingTeam, setViewingTeam] = useState(null);
  const [calendarSelectedEvent, setCalendarSelectedEvent] = useState(null);

  const [editingEvent, setEditingEvent] = useState(null);
  const [editFiles, setEditFiles] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

  const [cancelingEvent, setCancelingEvent] = useState(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationContact, setCancellationContact] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  const [reschedulingEvent, setReschedulingEvent] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleEndDate, setRescheduleEndDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleEndTime, setRescheduleEndTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleContact, setRescheduleContact] = useState("");

  const [editingContactEvent, setEditingContactEvent] = useState(null);
  const [contactEditValue, setContactEditValue] = useState("");

  const [refundLookupInput, setRefundLookupInput] = useState("");
  const [refundLookupResult, setRefundLookupResult] = useState(null);

  const [expandedEventId, setExpandedEventId] = useState(null);
  const [eventFilters, setEventFilters] = useState({});

  const [viewerSrc, setViewerSrc] = useState(null);

  const [requirementsEvent, setRequirementsEvent] = useState(null);
  const [reqNote, setReqNote] = useState("");
  const [reqFiles, setReqFiles] = useState([]);
  const [reqSaving, setReqSaving] = useState(false);

  const [attendeeTabs, setAttendeeTabs] = useState({});
  const [rejectingReg, setRejectingReg] = useState(null);
  const [rejectRegReason, setRejectRegReason] = useState("");
  const [busyRegId, setBusyRegId] = useState(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [dismissedNotifs, setDismissedNotifs] = useState([]);

  const defaultContactText = useMemo(() => {
    const parts = [];
    if (profile?.contact_number) parts.push(`Phone: ${profile.contact_number}`);
    if (user?.email) parts.push(`Email: ${user.email}`);
    return parts.join(" | ");
  }, [profile?.contact_number, user?.email]);

  const persistRegOverride = (regId, patch) => {
    setRegOverrides((prev) => {
      const key = String(regId);
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      try {
        window.localStorage.setItem(REG_OVERRIDE_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const persistEventOverride = (eventId, patch) => {
    setEventOverrides((prev) => {
      const key = String(eventId);
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      try {
        window.localStorage.setItem(EVENT_OVERRIDE_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const fetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      router.push("/login");
      return;
    }

    setUser(session.user);
    setNewEmail(session.user.email || "");

    const { data: userProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (userProfile?.role !== "organizer") {
      alert("Access Denied: Only verified event organizers can access this portal.");
      router.push("/programs");
      return;
    }

    setProfile(userProfile);

    const { data: allEventsData, error: eventsErr } = await supabase
      .from("tourism_programs")
      .select("*")
      .order("created_at", { ascending: false });

    if (eventsErr) {
      console.error("Error fetching events:", eventsErr.message);
    }

    setAllEvents(allEventsData || []);

    const orgId = session.user.id;
    const orgName = (userProfile.organization || "").trim().toLowerCase();
    const fullName = (userProfile.organizer_full_name || userProfile.full_name || "").trim().toLowerCase();

    const matchedEvents = (allEventsData || []).filter((event) => {
      const evOrgId = event.organizer_id;
      const evOrgName = (event.organizer_name || event.organizer || "").trim().toLowerCase();

      if (evOrgId && evOrgId === orgId) return true;
      if (orgName && evOrgName.includes(orgName)) return true;
      if (fullName && evOrgName.includes(fullName)) return true;
      return false;
    });

    setEvents(matchedEvents);

    const interestOnlyEvents = matchedEvents.filter((e) => regTypeOf(e) === "interested");
    if (interestOnlyEvents.length > 0) {
      const results = await Promise.all(
        interestOnlyEvents.map(async (ev) => {
          const { data, error } = await supabase.rpc("event_interested_list", { p_event_id: String(ev.id) });
          if (error) console.warn("Interested list warning:", error.message);
          return [String(ev.id), error ? null : data || []];
        })
      );
      setInterestedByEvent(Object.fromEntries(results));
    } else {
      setInterestedByEvent({});
    }

    const { data: attendeesData } = await supabase
      .from("event_registrations")
      .select("*")
      .order("created_at", { ascending: false });

    setAttendees(attendeesData || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData().then(() => {});

    const channel = supabase
      .channel("organizer-dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "tourism_programs" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "interested_events" }, () => fetchData())
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/programs");
  };

  const handleSaveEventEdit = async (e) => {
    e.preventDefault();
    const editMatches = findDuplicateEvents(editingEvent, allEvents);
    if (editMatches.length > 0) {
      const sample = editMatches[0];
      const proceed = await askConfirm({
        title: "Existing matching event warning",
        message: `An existing event "${sample.event_name}" (${sample.status || "Scheduled"} on ${sample.event_date || "TBA"} at ${sample.venue || "TBA"}) already matches this schedule. Do you still want to save and resubmit?`,
        confirmLabel: "Save & resubmit anyway",
        tone: "danger",
      });
      if (!proceed) return;
    }

    setEditSaving(true);
    try {
      let finalImageUrl = editingEvent.image_url;
      if (editFiles.length > 0) {
        const fileError = validateFiles(editFiles);
        if (fileError) {
          notify(fileError);
          setEditSaving(false);
          return;
        }
        const uploaded = await uploadAttachments(editFiles, `events/${editingEvent.id}`);
        if (uploaded.length > 0) {
          const existing = getImageList(editingEvent.image_url);
          finalImageUrl = JSON.stringify([...existing, ...uploaded]);
        }
      }

      const { error } = await supabase
        .from("tourism_programs")
        .update({
          image_url: finalImageUrl,
          description: editingEvent.description,
          event_date: editingEvent.event_date || null,
          event_end_date: editingEvent.event_end_date || null,
          event_time: editingEvent.event_time || null,
          event_end_time: editingEvent.event_end_time || null,
          status: "Pending",
        })
        .eq("id", editingEvent.id);

      if (error) throw error;
      setEditingEvent(null);
      setEditFiles([]);
      notify("Event proposal updated and resubmitted for review.", "info");
      await fetchData();
    } catch (err) {
      notify("Error updating event: " + err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const openCancelModal = (event) => {
    const existingMeta = parseEventActionMeta(event);
    setCancelingEvent(event);
    setCancellationReason("");
    setCancellationContact(existingMeta.organizer_contact_info || defaultContactText);
  };

  const handleRequestCancellation = async (e) => {
    e.preventDefault();
    if (!cancellationReason.trim()) return notify("Please provide a detailed reason for cancellation.", "info");
    if (!cancellationContact.trim()) {
      return notify("Please provide contact details where tourists can reach you for refunds or inquiries.", "info");
    }

    const ok = await askConfirm({
      title: "Proceed with event cancellation request?",
      message: `Are you sure you want to proceed with requesting cancellation for "${cancelingEvent.event_name}"? This request must be approved by the Tourism Office admin before taking effect, and your contact information will be provided to registered tourists.`,
      confirmLabel: "Yes, submit cancellation",
      tone: "danger",
    });
    if (!ok) return;

    setSubmittingAction(true);
    try {
      const encodedReason = buildFallbackReasonText({
        reason: cancellationReason.trim(),
        contactInfo: cancellationContact.trim(),
      });

      const fullPatch = {
        status: "Cancellation Requested",
        rejection_reason: encodedReason,
        organizer_contact_info: cancellationContact.trim(),
      };

      const corePatch = {
        status: "Cancellation Requested",
        rejection_reason: encodedReason,
      };

      let { error } = await supabase
        .from("tourism_programs")
        .update(fullPatch)
        .eq("id", cancelingEvent.id);

      if (error && isMissingColumnError(error)) {
        ({ error } = await supabase
          .from("tourism_programs")
          .update(corePatch)
          .eq("id", cancelingEvent.id));
      }

      if (error) throw error;

      persistEventOverride(cancelingEvent.id, fullPatch);
      setCancelingEvent(null);
      setCancellationReason("");
      setCancellationContact("");
      notify("Cancellation request submitted and awaiting admin approval.", "info");
      await fetchData();
    } catch (err) {
      notify("Error submitting cancellation request: " + err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const openRescheduleModal = (event) => {
    const existingMeta = parseEventActionMeta(event);
    setReschedulingEvent(event);
    setRescheduleDate(event.event_date || event.date || "");
    setRescheduleEndDate(event.event_end_date || event.end_date || "");
    setRescheduleTime(event.event_time || "");
    setRescheduleEndTime(event.event_end_time || "");
    setRescheduleReason("");
    setRescheduleContact(existingMeta.organizer_contact_info || defaultContactText);
  };

  const handleRequestReschedule = async (e) => {
    e.preventDefault();
    if (!rescheduleDate) return notify("Please select the proposed new start date.", "info");
    if (rescheduleEndDate && rescheduleEndDate < rescheduleDate) {
      return notify("The proposed end date cannot be earlier than the start date.", "info");
    }
    if (!rescheduleTime) return notify("Please select the proposed new start time.", "info");
    if (rescheduleEndTime && rescheduleEndTime <= rescheduleTime) {
      return notify("The proposed end time must be later than the start time.", "info");
    }
    if (!rescheduleReason.trim()) return notify("Please provide the reason for rescheduling this event.", "info");
    if (!rescheduleContact.trim()) {
      return notify("Please provide contact information where tourists can reach you if they want to request a refund instead of attending the rescheduled event.", "info");
    }

    const ok = await askConfirm({
      title: "Proceed with event rescheduling request?",
      message: `Are you sure you want to proceed with requesting to reschedule "${reschedulingEvent.event_name}" to ${rescheduleDate}? This request must be approved by the Tourism Office admin before joined tourists are notified.`,
      confirmLabel: "Yes, submit reschedule request",
    });
    if (!ok) return;

    setSubmittingAction(true);
    try {
      const encodedReason = buildFallbackReasonText({
        reason: rescheduleReason.trim(),
        contactInfo: rescheduleContact.trim(),
        reschedule: {
          date: rescheduleDate,
          endDate: rescheduleEndDate || rescheduleDate,
          time: rescheduleTime,
          endTime: rescheduleEndTime || "",
        },
      });

      const fullPatch = {
        status: "Reschedule Requested",
        rejection_reason: encodedReason,
        reschedule_reason: rescheduleReason.trim(),
        reschedule_date: rescheduleDate,
        reschedule_end_date: rescheduleEndDate || rescheduleDate,
        reschedule_time: rescheduleTime,
        reschedule_end_time: rescheduleEndTime || null,
        organizer_contact_info: rescheduleContact.trim(),
      };

      const corePatch = {
        status: "Reschedule Requested",
        rejection_reason: encodedReason,
      };

      let { error } = await supabase
        .from("tourism_programs")
        .update(fullPatch)
        .eq("id", reschedulingEvent.id);

      if (error && isMissingColumnError(error)) {
        ({ error } = await supabase
          .from("tourism_programs")
          .update(corePatch)
          .eq("id", reschedulingEvent.id));
      }

      if (error) throw error;

      persistEventOverride(reschedulingEvent.id, fullPatch);
      setReschedulingEvent(null);
      setRescheduleReason("");
      setRescheduleContact("");
      notify("Rescheduling request submitted and awaiting admin approval.", "info");
      await fetchData();
    } catch (err) {
      notify("Error submitting rescheduling request: " + err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const openContactEditor = (event) => {
    const meta = parseEventActionMeta(event);
    setEditingContactEvent(event);
    setContactEditValue(meta.organizer_contact_info || defaultContactText);
  };

  const handleSaveOrganizerContact = async (e) => {
    e.preventDefault();
    if (!contactEditValue.trim()) return notify("Please enter your contact details.", "info");
    setSubmittingAction(true);
    try {
      const meta = parseEventActionMeta(editingContactEvent);
      const updatedReason = buildFallbackReasonText({
        reason: meta.action_reason || "Organizer refund and support contact details",
        contactInfo: contactEditValue.trim(),
        reschedule: meta.reschedule_date
          ? {
              date: meta.reschedule_date,
              endDate: meta.reschedule_end_date,
              time: meta.reschedule_time,
              endTime: meta.reschedule_end_time,
            }
          : null,
      });

      const fullPatch = {
        organizer_contact_info: contactEditValue.trim(),
        rejection_reason: updatedReason,
      };

      let { error } = await supabase
        .from("tourism_programs")
        .update(fullPatch)
        .eq("id", editingContactEvent.id);

      if (error && isMissingColumnError(error)) {
        ({ error } = await supabase
          .from("tourism_programs")
          .update({ rejection_reason: updatedReason })
          .eq("id", editingContactEvent.id));
      }

      if (error) throw error;

      persistEventOverride(editingContactEvent.id, fullPatch);
      setEditingContactEvent(null);
      notify("Organizer refund & support contact details updated.", "info");
      await fetchData();
    } catch (err) {
      notify("Error saving contact details: " + err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const openRequirements = (event) => {
    setReqNote("");
    setReqFiles([]);
    setRequirementsEvent(event);
  };

  const handleSubmitRequirements = async (e) => {
    e.preventDefault();
    if (!reqNote.trim() && reqFiles.length === 0) {
      return notify("Please write a statement or attach at least one file.", "info");
    }
    const fileError = validateFiles(reqFiles);
    if (fileError) return notify(fileError);

    setReqSaving(true);
    try {
      let uploaded = [];
      if (reqFiles.length > 0) {
        uploaded = await uploadAttachments(reqFiles, `requirements/${requirementsEvent.id}`);
      }
      const existing = Array.isArray(requirementsEvent.requirement_files) ? requirementsEvent.requirement_files : [];

      const { error } = await supabase
        .from("tourism_programs")
        .update({
          status: "Requirements Submitted",
          requirement_files: [...existing, ...uploaded],
          requirement_note: reqNote.trim() || requirementsEvent.requirement_note || null,
          requirement_submitted_at: new Date().toISOString(),
        })
        .eq("id", requirementsEvent.id);

      if (error) throw error;
      setRequirementsEvent(null);
      notify("Requirements sent to the Tourism Office.", "info");
      await fetchData();
    } catch (err) {
      console.error("Submit requirements error:", err);
      notify("Error submitting requirements: " + (err.message || "Unknown error"));
    } finally {
      setReqSaving(false);
    }
  };

  const updateRegistration = async (reg, patch, corePatch = null) => {
    setBusyRegId(reg.id);
    try {
      const { error } = await supabase.from("event_registrations").update(patch).eq("id", reg.id);
      if (error) {
        if (isMissingColumnError(error)) {
          if (corePatch) {
            const { error: fallbackError } = await supabase
              .from("event_registrations")
              .update(corePatch)
              .eq("id", reg.id);
            if (fallbackError) throw fallbackError;
          }
          persistRegOverride(reg.id, patch);
          setAttendees((prev) => prev.map((a) => (a.id === reg.id ? { ...a, ...patch } : a)));
          return true;
        }
        throw error;
      }
      persistRegOverride(reg.id, patch);
      setAttendees((prev) => prev.map((a) => (a.id === reg.id ? { ...a, ...patch } : a)));
      return true;
    } catch (err) {
      console.error("Update registration error:", err);
      notify("Error updating registration: " + (err.message || "Unknown error"));
      return false;
    } finally {
      setBusyRegId(null);
    }
  };

  const confirmRegistration = async (reg) => {
    const generatedSerial = resolveRegistrationSerial({ ...reg, registration_status: "Confirmed" });
    const ok = await askConfirm({
      title: "Confirm this payment?",
      message: `${reg.first_name} ${reg.last_name} will be added to the official attendee list with Serial ID ${generatedSerial} and notified that the registration is successful.`,
      confirmLabel: "Yes, payment received",
    });
    if (!ok) return;
    const corePatch = {
      registration_status: "Confirmed",
      confirmed_at: new Date().toISOString(),
      rejection_reason: null,
    };
    const done = await updateRegistration(
      reg,
      {
        ...corePatch,
        serial_id: generatedSerial,
      },
      corePatch
    );
    if (done) notify(`Payment confirmed. Serial ID ${generatedSerial} issued.`, "info");
  };

  const moveToPending = async (reg) => {
    const ok = await askConfirm({
      title: "Move back to pending?",
      message: `${reg.first_name} ${reg.last_name} will leave the official attendee list until you confirm their payment again.`,
      confirmLabel: "Move to pending",
      tone: "danger",
    });
    if (!ok) return;
    const corePatch = { registration_status: "Pending", confirmed_at: null };
    const done = await updateRegistration(
      reg,
      {
        ...corePatch,
        serial_id: null,
        attendance_status: null,
        attendance_confirmed_at: null,
      },
      corePatch
    );
    if (done) notify("Registration moved back to pending.", "info");
  };

  const confirmAttendeePresence = async (reg) => {
    const serial = resolveRegistrationSerial(reg);
    const ok = await askConfirm({
      title: "Confirm attendee presence?",
      message: `Mark ${reg.first_name} ${reg.last_name}${serial ? ` (${serial})` : ""} as officially present at this event?`,
      confirmLabel: "Confirm present",
    });
    if (!ok) return;
    const done = await updateRegistration(reg, {
      attendance_status: "Confirmed",
      attendance_confirmed_at: new Date().toISOString(),
    });
    if (done) notify("Attendee presence confirmed.", "info");
  };

  const revertAttendeePresence = async (reg) => {
    const ok = await askConfirm({
      title: "Reset attendance confirmation?",
      message: `Revert ${reg.first_name} ${reg.last_name}'s confirmed attendance status?`,
      confirmLabel: "Revert status",
      tone: "danger",
    });
    if (!ok) return;
    const nextStatus = reg.checked_in_at || reg.tourist_checked_in ? "Marked" : null;
    const done = await updateRegistration(reg, {
      attendance_status: nextStatus,
      attendance_confirmed_at: null,
    });
    if (done) notify("Attendance confirmation reverted.", "info");
  };

  const confirmRefundForAttendee = async (reg) => {
    const serial = resolveRegistrationSerial(reg);
    const ok = await askConfirm({
      title: "Confirm refund successful?",
      message: `Confirm that you have verified Serial ID ${serial || "N/A"} and legitimate proof in your conversation with ${reg.first_name} ${reg.last_name}, and that their refund is complete? They will be moved to the Refunded Attendees list.`,
      confirmLabel: "Yes, confirm refund",
    });
    if (!ok) return;

    const nowIso = new Date().toISOString();
    const fullPatch = {
      refund_status: "Refunded",
      refunded_at: nowIso,
      refund_confirmed: true,
    };
    const done = await updateRegistration(reg, fullPatch, null);
    if (done) {
      if (refundLookupResult && String(refundLookupResult.reg?.id) === String(reg.id)) {
        setRefundLookupResult({
          ...refundLookupResult,
          reg: { ...reg, ...fullPatch },
        });
      }
      notify(`Refund confirmed for ${reg.first_name} ${reg.last_name} (${serial}). Moved to Refunded Attendees.`, "info");
    }
  };

  const revertRefundForAttendee = async (reg) => {
    const ok = await askConfirm({
      title: "Revert refund confirmation?",
      message: `Move ${reg.first_name} ${reg.last_name} back out of the Refunded Attendees list?`,
      confirmLabel: "Revert refund",
      tone: "danger",
    });
    if (!ok) return;

    const patch = {
      refund_status: "Requested",
      refunded_at: null,
      refund_confirmed: false,
    };
    const done = await updateRegistration(reg, patch, null);
    if (done) notify("Refund status reverted.", "info");
  };

  const handleRefundSerialLookup = (e) => {
    e.preventDefault();
    const raw = refundLookupInput.trim().toUpperCase();
    if (!raw) {
      return notify("Please enter the tourist's Serial ID (e.g. DAET-17-99695D) to verify their registration for refund.", "info");
    }

    const subMatch = raw.match(/^(DAET-[A-Z0-9]+-[A-Z0-9]+)-(\d+)$/);
    const baseCode = subMatch ? subMatch[1] : raw;

    const myEventIds = new Set(events.map((ev) => String(ev.id)));
    const matched = attendees.find((a) => {
      if (!myEventIds.has(String(a.event_id))) return false;
      const s = resolveRegistrationSerial(a).toUpperCase();
      return s && (s === raw || s === baseCode);
    });

    if (!matched) {
      setRefundLookupResult({ notFound: true, query: raw });
      return;
    }

    const matchedEvent = events.find((ev) => String(ev.id) === String(matched.event_id)) || null;
    setRefundLookupResult({
      notFound: false,
      query: raw,
      reg: matched,
      event: matchedEvent,
    });
    setExpandedEventId(matched.event_id);
  };

  const handleRejectRegistration = async (e) => {
    e.preventDefault();
    if (!rejectRegReason.trim()) return notify("Please tell the participant why the registration was rejected.", "info");
    const done = await updateRegistration(rejectingReg, {
      registration_status: "Rejected",
      rejection_reason: rejectRegReason.trim(),
      confirmed_at: null,
    });
    if (done) {
      setRejectingReg(null);
      setRejectRegReason("");
      notify("Registration rejected.", "info");
    }
  };

  const handleDismissNotification = (eventId) => {
    setDismissedNotifs((prev) => [...prev, eventId]);
  };

  const duplicatesByEventId = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const matches = findDuplicateEvents(ev, allEvents);
      if (matches.length > 0) map.set(String(ev.id), matches);
    });
    return map;
  }, [events, allEvents]);

  const totalEvents = events.length;
  const activeEventsList = events.filter((e) =>
    ["approved", "upcoming", "ongoing", "rescheduled"].includes((e.status || "").toLowerCase())
  );
  const managedEventsList = events.filter((e) =>
    [
      "approved",
      "upcoming",
      "ongoing",
      "completed",
      "rescheduled",
      "reschedule requested",
      "cancellation requested",
      "cancelled",
    ].includes((e.status || "").toLowerCase())
  );
  const approvedEvents = activeEventsList.length;
  const rejectedEvents = events.filter((e) => e.status?.toLowerCase() === "rejected").length;
  const completedEvents = events.filter((e) => e.status?.toLowerCase() === "completed").length;
  const underReviewEvents = events.filter((e) =>
    ["pending", "under review", "requirements submitted", "reschedule requested", "cancellation requested"].includes(
      (e.status || "").toLowerCase()
    )
  ).length;
  const requiresChangesEvents = events.filter((e) =>
    ["requires changes", "requirements needed"].includes((e.status || "").toLowerCase())
  ).length;
  const pendingForApproval = events.filter((e) => e.status?.toLowerCase() === "pending").length;

  const managedEventIds = managedEventsList.map((e) => String(e.id));
  const approvedAttendees = attendees.filter(
    (a) => managedEventIds.includes(String(a.event_id)) && regState(a) === "confirmed" && resolveRefundState(a) !== "refunded"
  );
  const pendingPaymentCount = attendees.filter(
    (a) => managedEventIds.includes(String(a.event_id)) && regState(a) === "pending"
  ).length;
  const pendingAttendanceCount = approvedAttendees.filter((a) => resolveAttendanceState(a) === "marked").length;
  const pendingRefundRequestsCount = attendees.filter(
    (a) => managedEventIds.includes(String(a.event_id)) && resolveRefundState(a) === "requested"
  ).length;

  const visibleNotifications = events.filter((e) => !dismissedNotifs.includes(e.id));
  const activeNotifsCount = visibleNotifications.length;

  if (loading) {
    return (
      <div className="daet-ui min-h-[60vh] flex flex-col items-center justify-center gap-3 text-sm font-semibold text-slate-400">
        <div className="w-7 h-7 border-2 border-blue-900/20 border-t-blue-900 rounded-full animate-spin" />
        <span>Authenticating organizer credentials...</span>
      </div>
    );
  }

  return (
    <div className="daet-ui">
      <DashboardShell
        roleLabel="Organizer"
        name={profile?.organization || "Event organizer"}
        subtitle={`Host: ${profile?.organizer_full_name || profile?.full_name || ""}`}
        activeKey={activeTab}
        onNavigate={setActiveTab}
        nav={[
          { key: "overview", label: "Overview", icon: "home" },
          { key: "my-events", label: "My events", icon: "calendar-check" },
          { key: "calendar", label: "Event calendar", icon: "calendar" },
          {
            key: "attendees",
            label: "Attendees and payments",
            icon: "users",
            badge: pendingPaymentCount + pendingAttendanceCount + pendingRefundRequestsCount,
            tone: "amber",
          },
          { key: "notifications", label: "Notifications", icon: "bell", badge: activeNotifsCount > 0 ? activeNotifsCount : undefined, tone: "blue" },
          { key: "profile", label: "Organizer profile", icon: "user" },
          { key: "settings", label: "Account settings", icon: "settings" },
        ]}
        primaryAction={{ label: "View public programs", href: "/programs", icon: "arrow" }}
        onLogout={handleLogout}
      >
        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Dashboard Overview</h1>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">Live operational metrics and event proposal status tracker</p>
              </div>
              <Link href="/programs/submit">
                <button className="px-4 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all flex items-center gap-1.5">
                  <span>+ Submit Event Proposal</span>
                </button>
              </Link>
            </div>

            {duplicatesByEventId.size > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                    Duplicate / Same-Schedule Event Warning ({duplicatesByEventId.size})
                  </p>
                  <p className="font-semibold">
                    One or more of your events shares a title or date/venue with an already existing event in the tourism schedule.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("my-events")}
                  className="px-3.5 py-2 bg-amber-900 hover:bg-amber-800 text-white rounded-xl font-bold text-[11px] uppercase whitespace-nowrap transition-all"
                >
                  Inspect Events
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-slate-400 group-hover:text-slate-600 transition-colors">Total Submitted</span>
                <p className="dash-stat-value text-slate-900 mt-1">{totalEvents}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-emerald-700">Approved / Active</span>
                <p className="dash-stat-value text-emerald-700 mt-1">{approvedEvents}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-amber-700">Under Review</span>
                <p className="dash-stat-value text-amber-700 mt-1">{underReviewEvents}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-purple-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-purple-700">Requires Changes</span>
                <p className="dash-stat-value text-purple-700 mt-1">{requiresChangesEvents}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-slate-400 group-hover:text-slate-600 transition-colors">Completed</span>
                <p className="dash-stat-value text-slate-900 mt-1">{completedEvents}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-red-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-red-700">Rejected</span>
                <p className="dash-stat-value text-red-700 mt-1">{rejectedEvents}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("attendees")}
                className="dash-stat text-left hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-blue-900">Official Attendees</span>
                <p className="dash-stat-value text-blue-900 mt-1">{approvedAttendees.length}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("my-events")}
                className="dash-stat text-left hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="dash-stat-label text-amber-700">Pending Approval</span>
                <p className="dash-stat-value text-amber-700 mt-1">{pendingForApproval}</p>
              </button>
            </div>
          </div>
        )}

        {activeTab === "my-events" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">My Submitted Events</h1>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">Manage and review your submitted event proposals, request rescheduling or cancellation, and provide support contact details.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("overview")}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
                >
                  ← Overview
                </button>
                <Link href="/programs/submit">
                  <button className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all whitespace-nowrap shadow-sm">
                    + Create Event
                  </button>
                </Link>
              </div>
            </div>

            {events.length === 0 ? (
              <div className="bg-white p-14 rounded-2xl border border-dashed border-slate-200 text-center space-y-3">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">No events submitted yet</p>
                <Link href="/programs/submit">
                  <button className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all">
                    Submit Your First Proposal
                  </button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {events.map((event) => {
                  const status = (event.status || "").toLowerCase();
                  const isApproved =
                    status === "approved" || status === "upcoming" || status === "ongoing" || status === "rescheduled";
                  const isRejectedOrRevision = status === "rejected" || status === "requires changes";
                  const needsRequirements = status === "requirements needed";
                  const requirementsSent = status === "requirements submitted";
                  const isRescheduleOrCancelFlow =
                    status === "cancellation requested" ||
                    status === "cancelled" ||
                    status === "reschedule requested" ||
                    status === "rescheduled";
                  const approvalFiles = Array.isArray(event.approval_files) ? event.approval_files : [];
                  const requirementFiles = Array.isArray(event.requirement_files) ? event.requirement_files : [];
                  const eventImages = getImageList(event.image_url);
                  const duplicateMatches = duplicatesByEventId.get(String(event.id)) || [];
                  const actionMeta = parseEventActionMeta(event);

                  return (
                    <div
                      key={event.id}
                      className="bg-white p-5 rounded-2xl border border-slate-200/90 hover:border-slate-300 flex flex-col md:flex-row justify-between gap-5 shadow-sm transition-all"
                    >
                      {eventImages.length > 0 ? (
                        <ImageCarousel
                          images={eventImages}
                          onPreview={setViewerSrc}
                          className={EVENT_THUMB}
                        />
                      ) : (
                        <div className={`${EVENT_THUMB} flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-wider`}>
                          No Photo
                        </div>
                      )}

                      <div className="space-y-3 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-base text-slate-900 mr-1">{event.event_name}</h3>
                          <span className={`px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase ${statusBadge(event.status)}`}>
                            {event.status || "Pending"}
                          </span>
                          {(needsRequirements || requirementsSent) && (
                            <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-teal-600 text-white">
                              Approval Letter
                            </span>
                          )}
                          {event.is_paid && (
                            <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-blue-900 text-white">
                              {peso(event.fee_amount)}
                            </span>
                          )}
                          <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase bg-slate-100 text-slate-600">
                            {REG_TYPE_LABEL[regTypeOf(event)]}
                          </span>
                        </div>

                        {duplicateMatches.length > 0 && (
                          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-950 space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                              Warning: Existing Matching Event Detected ({duplicateMatches.length})
                            </p>
                            <p className="font-medium">
                              Matches{" "}
                              {duplicateMatches
                                .slice(0, 2)
                                .map((m) => `"${m.event_name}" (${m.status || "Scheduled"}, ${m.event_date || "TBA"} at ${m.venue || "TBA"})`)
                                .join(" and ")}
                              . Duplicate events are discouraged in the official schedule.
                            </p>
                          </div>
                        )}

                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{event.description}</p>

                        <div className="flex flex-wrap gap-2 pt-0.5 text-[11px] font-semibold text-slate-600">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100">
                            <strong className="text-slate-800">Venue:</strong> {event.venue || "TBA"}
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100">
                            <strong className="text-slate-800">Date:</strong> {event.event_date || "TBA"} {event.event_end_date && event.event_end_date !== event.event_date ? `to ${event.event_end_date}` : ""}
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100">
                            <strong className="text-slate-800">Time:</strong> {formatTimeRange(event) || "TBA"}
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100">
                            <strong className="text-slate-800">Fee:</strong> {event.is_paid ? peso(event.fee_amount) : "Free"}
                          </span>
                        </div>

                        {isRescheduleOrCancelFlow && (
                          <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3.5 text-xs space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[10px] font-black uppercase tracking-wider text-blue-900">
                                {status === "reschedule requested"
                                  ? "Rescheduling Request — Awaiting Admin Approval"
                                  : status === "rescheduled"
                                  ? "Event Rescheduled — Tourist Support & Refund Contact"
                                  : status === "cancellation requested"
                                  ? "Cancellation Request — Awaiting Admin Approval"
                                  : "Event Cancelled — Tourist Support & Refund Contact"}
                              </span>
                              <button
                                type="button"
                                onClick={() => openContactEditor(event)}
                                className="text-[11px] font-bold text-blue-900 hover:underline"
                              >
                                Update Contact Info
                              </button>
                            </div>
                            {actionMeta.reschedule_date && (
                              <p className="text-slate-700 font-medium">
                                <strong>Proposed / New Schedule:</strong> {actionMeta.reschedule_date}
                                {actionMeta.reschedule_end_date && actionMeta.reschedule_end_date !== actionMeta.reschedule_date
                                  ? ` to ${actionMeta.reschedule_end_date}`
                                  : ""}
                                {actionMeta.reschedule_time ? ` • ${actionMeta.reschedule_time}` : ""}
                                {actionMeta.reschedule_end_time ? ` - ${actionMeta.reschedule_end_time}` : ""}
                              </p>
                            )}
                            {actionMeta.action_reason && (
                              <p className="text-slate-700 font-medium">
                                <strong>Reason:</strong> {actionMeta.action_reason}
                              </p>
                            )}
                            <p className="text-slate-800 font-semibold">
                              <strong>Tourist Refund / Inquiry Contact:</strong>{" "}
                              {actionMeta.organizer_contact_info || "Not yet provided — click Update Contact Info"}
                            </p>
                          </div>
                        )}

                        {(needsRequirements || requirementsSent) && (
                          <div className="bg-teal-50/80 border border-teal-200/80 rounded-xl p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[10px] font-black text-teal-800 uppercase tracking-wider">
                                Approval letter from the Tourism Office
                              </p>
                              {event.approval_sent_at && (
                                <span className="text-[10px] text-teal-700 font-semibold">{new Date(event.approval_sent_at).toLocaleString()}</span>
                              )}
                            </div>
                            <p className="text-xs font-bold text-teal-900">
                              {needsRequirements
                                ? "Action required: complete the requirements below before your event can be published on the main page."
                                : "Your requirements were sent. Waiting for the Tourism Office to review them."}
                            </p>
                            {event.approval_instructions && (
                              <div className="space-y-1 bg-white/70 rounded-lg p-3 border border-teal-100">
                                <p className="text-[10px] font-black text-teal-700 uppercase tracking-wider">What you need to do</p>
                                <p className="text-xs text-teal-900 font-medium whitespace-pre-line">{event.approval_instructions}</p>
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-black text-teal-700 uppercase tracking-wider">Files from the Tourism Office</p>
                                <AttachmentList files={approvalFiles} onPreview={setViewerSrc} emptyText="No file was attached to this letter." />
                              </div>
                              {(requirementFiles.length > 0 || event.requirement_note) && (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-black text-cyan-800 uppercase tracking-wider">
                                    What you sent
                                    {event.requirement_submitted_at && (
                                      <span className="text-cyan-700 font-semibold normal-case block sm:inline sm:ml-1">
                                        ({new Date(event.requirement_submitted_at).toLocaleString()})
                                      </span>
                                    )}
                                  </p>
                                  {event.requirement_note && (
                                    <p className="text-xs text-slate-800 font-medium whitespace-pre-line">{event.requirement_note}</p>
                                  )}
                                  <AttachmentList files={requirementFiles} onPreview={setViewerSrc} />
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {isRejectedOrRevision && (event.revision_notes || event.rejection_reason) && (
                          <div className="text-xs text-purple-800 bg-purple-50/90 border border-purple-200/70 rounded-xl p-3.5">
                            <strong className="uppercase text-[10px] tracking-wider block text-purple-900 mb-0.5">Admin note</strong>
                            {actionMeta.action_reason || event.revision_notes || event.rejection_reason}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap md:flex-col md:items-stretch justify-end md:justify-start items-center gap-2 min-w-[180px] pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                        {(needsRequirements || requirementsSent) && (
                          <button
                            onClick={() => openRequirements(event)}
                            className="w-full text-center px-3.5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl uppercase transition-all shadow-sm"
                          >
                            {needsRequirements ? "Submit Requirements" : "Add / Update Files"}
                          </button>
                        )}

                        {isRejectedOrRevision && (
                          <button
                            onClick={() => {
                              setEditingEvent(event);
                              setEditFiles([]);
                            }}
                            className="w-full text-center px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl uppercase transition-all"
                          >
                            Edit Details
                          </button>
                        )}

                        {isApproved && (
                          <>
                            <button
                              type="button"
                              onClick={() => openRescheduleModal(event)}
                              className="w-full text-center px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 text-xs font-bold rounded-xl uppercase transition-all"
                            >
                              Request Event Rescheduling
                            </button>
                            <button
                              type="button"
                              onClick={() => openCancelModal(event)}
                              className="w-full text-center px-3.5 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200/60 text-red-600 text-xs font-bold rounded-xl uppercase transition-all"
                            >
                              Cancel Event
                            </button>
                          </>
                        )}

                        {(status === "cancelled" || status === "rescheduled") && (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedEventId(event.id);
                              setActiveTab("attendees");
                            }}
                            className="w-full text-center px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl uppercase transition-all"
                          >
                            Attendees & Refunds
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "calendar" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Event Schedule Calendar</h1>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  Browse all official events posted in the main programs, or switch to view solely your own event schedule.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("overview")}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
                >
                  ← Overview
                </button>
                <Link href="/programs/submit">
                  <button className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all whitespace-nowrap shadow-sm">
                    + Propose Event
                  </button>
                </Link>
              </div>
            </div>

            <EventCalendar
              events={allEvents}
              role="organizer"
              organizerProfile={profile}
              organizerEvents={events}
              onSelectEvent={(ev) => setCalendarSelectedEvent(ev)}
            />
          </div>
        )}

        {activeTab === "attendees" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Event Attendees, Attendance & Refunds
                </h1>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  Confirm participant payments to assign official Serial IDs, monitor attendance, and verify Serial IDs to process refunds for rescheduled or cancelled events.
                </p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap self-start md:self-auto"
              >
                ← Overview
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-900 bg-blue-50 px-2.5 py-1 rounded-full">
                  Serial ID Refund Verification
                </span>
                <h2 className="text-sm font-black text-slate-900 mt-1.5">
                  Verify Tourist Serial ID & Confirm Refund
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Search a tourist's Serial ID from your conversation outside the system to verify their registration and confirm their refund.
                </p>
              </div>

              <form onSubmit={handleRefundSerialLookup} className="flex flex-col sm:flex-row gap-2.5 text-xs">
                <input
                  type="text"
                  placeholder="Enter Serial ID (e.g. DAET-17-99695D)"
                  value={refundLookupInput}
                  onChange={(e) => setRefundLookupInput(e.target.value)}
                  className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
                <button
                  type="submit"
                  className="px-5 py-3 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  Verify Serial ID
                </button>
                {refundLookupResult && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefundLookupResult(null);
                      setRefundLookupInput("");
                    }}
                    className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all"
                  >
                    Clear
                  </button>
                )}
              </form>

              {refundLookupResult && (
                <div>
                  {refundLookupResult.notFound ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-1">
                      <p className="font-black uppercase text-[10px] tracking-wider text-red-700">Serial ID Not Found</p>
                      <p className="font-semibold">
                        No attendee registration across your events matched <span className="font-mono">{refundLookupResult.query}</span>.
                      </p>
                    </div>
                  ) : (
                    (() => {
                      const matchedReg = refundLookupResult.reg;
                      const matchedEv = refundLookupResult.event;
                      const matchedSerial = resolveRegistrationSerial(matchedReg);
                      const refundSt = resolveRefundState(matchedReg);
                      return (
                        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2.5 py-0.5 rounded-lg bg-blue-950 text-white font-mono font-bold text-[11px]">
                                {matchedSerial}
                              </span>
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                  refundSt === "refunded"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : refundSt === "requested"
                                    ? "bg-amber-100 text-amber-900"
                                    : "bg-blue-100 text-blue-900"
                                }`}
                              >
                                {refundSt === "refunded"
                                  ? "Refund Confirmed"
                                  : refundSt === "requested"
                                  ? "Refund Requested by Tourist"
                                  : `Status: ${matchedReg.registration_status || "Confirmed"}`}
                              </span>
                            </div>
                            <p className="font-black text-slate-900 text-sm">
                              {matchedReg.first_name} {matchedReg.last_name}
                              {matchedReg.team_name ? ` (Team: ${matchedReg.team_name})` : ""}
                            </p>
                            <p className="text-slate-600 font-medium">
                              Event: <strong className="text-slate-800">{matchedEv?.event_name || "Event"}</strong> • Contact: {matchedReg.phone_number} • {matchedReg.email}
                            </p>
                            <p className="text-slate-600 font-medium">
                              Payment: <strong className="text-slate-800">{matchedReg.payment_method || "Free"}</strong>
                              {matchedReg.amount_due ? ` (${peso(matchedReg.amount_due)})` : ""}
                              {matchedReg.payment_reference ? ` • Ref: ${matchedReg.payment_reference}` : ""}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {refundSt !== "refunded" ? (
                              <button
                                type="button"
                                disabled={busyRegId === matchedReg.id}
                                onClick={() => confirmRefundForAttendee(matchedReg)}
                                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-bold uppercase text-[11px] transition-all shadow-sm"
                              >
                                Confirm Refund Successful
                              </button>
                            ) : (
                              <span className="px-3.5 py-2 rounded-xl bg-emerald-100 text-emerald-900 font-black uppercase text-[11px]">
                                Moved to Refunded Attendees
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}
            </div>

            {managedEventsList.length === 0 ? (
              <div className="bg-white p-14 rounded-2xl border border-dashed border-slate-200 text-center text-slate-400 text-xs font-bold uppercase tracking-wider">
                No approved events available to display attendees.
              </div>
            ) : (
              <div className="space-y-4">
                {managedEventsList.map((event) => {
                  const eventRegs = attendees.filter((a) => String(a.event_id) === String(event.id));
                  const regType = regTypeOf(event);
                  const interestRows = interestedByEvent[String(event.id)];
                  const isOnline = (a) => (a.payment_method || "").toLowerCase() === "online";
                  const refunded = eventRegs.filter((a) => resolveRefundState(a) === "refunded");
                  const official = eventRegs.filter(
                    (a) => regState(a) === "confirmed" && resolveRefundState(a) !== "refunded"
                  );
                  const pendingCash = eventRegs.filter(
                    (a) => regState(a) === "pending" && !isOnline(a) && resolveRefundState(a) !== "refunded"
                  );
                  const pendingOnline = eventRegs.filter(
                    (a) => regState(a) === "pending" && isOnline(a) && resolveRefundState(a) !== "refunded"
                  );
                  const rejected = eventRegs.filter(
                    (a) => regState(a) === "rejected" && resolveRefundState(a) !== "refunded"
                  );
                  const pendingTotal = pendingCash.length + pendingOnline.length;
                  const refundReqCount = official.filter((a) => resolveRefundState(a) === "requested").length;
                  const presentCount = official.filter((a) => resolveAttendanceState(a) === "confirmed").length;
                  const checkedInAwaitingCount = official.filter((a) => resolveAttendanceState(a) === "marked").length;
                  const showPaymentTabs = !!event.is_paid || pendingTotal + rejected.length > 0;
                  const statusLower = (event.status || "").toLowerCase();
                  const isOngoingEvent = statusLower === "ongoing";
                  const isCancelledOrRescheduled =
                    statusLower === "cancelled" ||
                    statusLower === "cancellation requested" ||
                    statusLower === "rescheduled" ||
                    statusLower === "reschedule requested";
                  const actionMeta = parseEventActionMeta(event);

                  const isExpanded = expandedEventId === event.id;
                  const defaultTab = isOngoingEvent ? "attendance" : "official";
                  const tab = attendeeTabs[event.id] || defaultTab;
                  const lists = {
                    official,
                    attendance: official,
                    "pending-cash": pendingCash,
                    "pending-online": pendingOnline,
                    rejected,
                    refunded,
                  };
                  const tabs = [
                    ["official", "Official Attendees", official.length],
                    ["attendance", "Official Attendance List", `${presentCount}/${official.length}`],
                    ...(showPaymentTabs
                      ? [
                          ["pending-cash", "Pending - Cash", pendingCash.length],
                          ["pending-online", "Pending - Online", pendingOnline.length],
                          ["rejected", "Rejected", rejected.length],
                        ]
                      : []),
                    ...(event.is_paid || refunded.length > 0 || refundReqCount > 0 || isCancelledOrRescheduled
                      ? [["refunded", "Refunded Attendees", refunded.length]]
                      : []),
                  ];

                  const currentFilters = eventFilters[event.id] || {
                    gender: "All",
                    ageBracket: "All",
                    attendance: "All",
                    search: "",
                  };
                  const query = (currentFilters.search || "").trim().toLowerCase();
                  const filteredList = (lists[tab] || []).filter((a) => {
                    if (currentFilters.gender !== "All" && a.gender?.toLowerCase() !== currentFilters.gender.toLowerCase()) return false;
                    const age = parseInt(a.age, 10) || 0;
                    if (currentFilters.ageBracket === "Youth (1-17)" && age >= 18) return false;
                    if (currentFilters.ageBracket === "Adult (18-59)" && (age < 18 || age > 59)) return false;
                    if (currentFilters.ageBracket === "Senior (60+)" && age < 60) return false;
                    if (tab === "attendance" && currentFilters.attendance && currentFilters.attendance !== "All") {
                      if (resolveAttendanceState(a) !== currentFilters.attendance) return false;
                    }
                    if (query) {
                      const serial = resolveRegistrationSerial(a);
                      const full = `${a.first_name || ""} ${a.last_name || ""} ${a.email || ""} ${a.team_name || ""} ${serial}`.toLowerCase();
                      if (!full.includes(query)) return false;
                    }
                    return true;
                  });

                  const emptyText = {
                    official: "No official attendees match the filter criteria for this event.",
                    attendance: "No official attendees match the attendance filter for this event.",
                    "pending-cash": "No participants are waiting to pay in cash.",
                    "pending-online": "No participants are waiting for an online payment check.",
                    rejected: "No rejected registrations.",
                    refunded: "No attendees have been marked as refunded for this event yet.",
                  }[tab];

                  const isOfficialOrAttendanceTab = tab === "official" || tab === "attendance" || tab === "refunded";

                  return (
                    <div key={event.id} className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <h3 className="font-black text-base text-slate-900">{event.event_name}</h3>
                            <span className={`px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase ${statusBadge(event.status)}`}>
                              {event.status || "Approved"}
                            </span>
                            <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-blue-900 text-white">
                              {regType === "interested"
                                ? "Interested only"
                                : `${regType === "group" ? "Group - " : ""}${event.is_paid ? `Paid - ${peso(event.fee_amount)}` : "Free"}`}
                            </span>
                            {pendingTotal > 0 && (
                              <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-amber-400 text-slate-950">
                                {pendingTotal} payment pending
                              </span>
                            )}
                            {refundReqCount > 0 && (
                              <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-900 border border-amber-300">
                                {refundReqCount} refund requested
                              </span>
                            )}
                            {refunded.length > 0 && (
                              <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-slate-200 text-slate-800">
                                {refunded.length} refunded
                              </span>
                            )}
                            {checkedInAwaitingCount > 0 && (
                              <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-900 border border-amber-300">
                                {checkedInAwaitingCount} checked in
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">
                            Date: <strong className="text-slate-700">{event.event_date || "TBA"}</strong> •{" "}
                            {regType === "interested" ? (
                              <>Interested tourists: <strong className="text-slate-800">{Array.isArray(interestRows) ? interestRows.length : "-"}</strong></>
                            ) : (
                              <>
                                Official {regType === "group" ? "teams" : "attendees"}: <strong className="text-slate-800">{official.length}</strong> •{" "}
                                Confirmed present: <strong className="text-emerald-700">{presentCount} / {official.length}</strong>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                          {regType !== "interested" && isOngoingEvent && (
                            <button
                              type="button"
                              onClick={() => {
                                setAttendeeTabs({ ...attendeeTabs, [event.id]: "attendance" });
                                setExpandedEventId(event.id);
                              }}
                              className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm"
                            >
                              Monitor Attendance
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                            className="w-full md:w-44 text-center flex-shrink-0 px-4 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm"
                          >
                            {isExpanded ? (regType === "interested" ? "Hide Interested ▲" : "Hide Attendees ▲") : regType === "interested" ? "View Interested ▼" : "Inspect Attendees ▼"}
                          </button>
                        </div>
                      </div>

                      {isExpanded && isCancelledOrRescheduled && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <p className="font-black text-slate-900 uppercase text-[10px] tracking-wider">
                              {statusLower === "cancelled"
                                ? "Cancelled Event — Attendee Records Preserved for Refund Processing"
                                : "Rescheduled Event — Attendee & Refund Support"}
                            </p>
                            <p className="text-slate-600 font-medium">
                              Tourist Support Contact:{" "}
                              <strong className="text-slate-900">
                                {actionMeta.organizer_contact_info || "Not set"}
                              </strong>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openContactEditor(event)}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-blue-900 rounded-xl font-bold text-[11px] self-start sm:self-center"
                          >
                            Edit Contact Info
                          </button>
                        </div>
                      )}

                      {isExpanded && regType === "interested" && (
                        <div className="pt-4 border-t border-slate-100 space-y-4">
                          <p className="text-xs text-blue-900 bg-blue-50/80 border border-blue-100 rounded-xl p-3.5 font-medium">
                            This event has no official registration. These are the tourists who tapped <strong>Interested</strong>, so you can estimate how many people to expect.
                          </p>
                          {interestRows === null || interestRows === undefined ? (
                            <div className="p-6 text-center text-red-600 bg-red-50 rounded-xl text-xs font-bold">
                              {interestRows === null
                                ? "The interested list could not be loaded. Ask the administrator to run the interested-events SQL setup."
                                : "Loading..."}
                            </div>
                          ) : interestRows.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase">No tourists have marked this event as interested yet.</div>
                          ) : (
                            <>
                              <p className="text-xs font-black uppercase text-slate-700">Total interested: {interestRows.length}</p>
                              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-50 font-bold uppercase text-[11px] text-slate-500 border-b border-slate-200">
                                    <tr>
                                      <th className="p-3.5">Tourist</th>
                                      <th className="p-3.5">Email</th>
                                      <th className="p-3.5">Contact</th>
                                      <th className="p-3.5">Marked interested</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                                    {interestRows.map((row) => (
                                      <tr key={row.user_id} className="hover:bg-slate-50/70 transition-colors">
                                        <td className="p-3.5 font-bold text-slate-900">{row.full_name || "Tourist"}</td>
                                        <td className="p-3.5">{row.email || "-"}</td>
                                        <td className="p-3.5">{row.contact_number || "-"}</td>
                                        <td className="p-3.5">{row.created_at ? new Date(row.created_at).toLocaleDateString() : "N/A"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {isExpanded && regType !== "interested" && (
                        <div className="pt-4 border-t border-slate-100 space-y-4">
                          <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1.5 rounded-2xl w-fit max-w-full">
                            {tabs.map(([key, label, count]) => (
                              <button
                                key={key}
                                onClick={() => setAttendeeTabs({ ...attendeeTabs, [event.id]: key })}
                                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                  tab === key ? "bg-white text-blue-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                                }`}
                              >
                                {label}{" "}
                                <span
                                  className={`ml-1 ${
                                    (key.startsWith("pending") && Number(count) > 0) ||
                                    (key === "attendance" && checkedInAwaitingCount > 0)
                                      ? "text-amber-600 font-black"
                                      : "text-slate-400 font-semibold"
                                  }`}
                                >
                                  {count}
                                </span>
                              </button>
                            ))}
                          </div>

                          {tab === "attendance" && (
                            <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                              <div className="space-y-0.5">
                                <p className="font-black text-emerald-950 uppercase text-[10px] tracking-wider">
                                  Official Event Attendance Monitor
                                </p>
                                <p className="text-emerald-900 font-medium">
                                  Verify Serial IDs and confirm attendance for tourists who marked themselves present on their dashboard.
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2 text-[11px] font-black">
                                <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-800">
                                  Present: {presentCount}
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900">
                                  Awaiting Confirm: {checkedInAwaitingCount}
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700">
                                  Not Checked In: {Math.max(0, official.length - presentCount - checkedInAwaitingCount)}
                                </span>
                              </div>
                            </div>
                          )}

                          {tab === "pending-cash" && (
                            <div className="text-xs text-slate-600 bg-amber-50/60 border border-amber-200/70 rounded-xl p-3.5 font-medium space-y-1">
                              <p>
                                <strong className="text-slate-800">Cash is handed over at:</strong>{" "}
                                {event.cash_payment_details || "The organizer did not state a cash payment location on the proposal."}
                              </p>
                              <p className="text-[11px] text-slate-500">Confirm a participant only after you have received their payment to issue their official Serial ID.</p>
                            </div>
                          )}
                          {tab === "pending-online" && (
                            <div className="text-xs text-slate-600 bg-blue-50/60 border border-blue-200/70 rounded-xl p-3.5 font-medium space-y-1">
                              <p>
                                <strong className="text-slate-800">Online payments go to:</strong>{" "}
                                {event.online_payment_details || "The organizer did not state online payment details on the proposal."}
                              </p>
                              <p className="text-[11px] text-slate-500">Check the reference number / receipt against your account, then confirm to assign their official Serial ID.</p>
                            </div>
                          )}

                          <div className="flex flex-col lg:flex-row justify-between lg:items-center bg-slate-50 border border-slate-200/70 p-3.5 rounded-xl gap-3 text-xs">
                            <span className="font-bold uppercase text-slate-700 tracking-wide">
                              {tabs.find((t) => t[0] === tab)?.[1]} ({filteredList.length})
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                placeholder="Search serial ID, name, email, team..."
                                value={currentFilters.search || ""}
                                onChange={(e) =>
                                  setEventFilters({
                                    ...eventFilters,
                                    [event.id]: { ...currentFilters, search: e.target.value },
                                  })
                                }
                                className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900/20 w-full sm:w-56"
                              />
                              {tab === "attendance" && (
                                <select
                                  value={currentFilters.attendance || "All"}
                                  onChange={(e) =>
                                    setEventFilters({
                                      ...eventFilters,
                                      [event.id]: { ...currentFilters, attendance: e.target.value },
                                    })
                                  }
                                  className="px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                >
                                  <option value="All">All Attendance</option>
                                  <option value="marked">Tourist Checked In</option>
                                  <option value="confirmed">Present (Confirmed)</option>
                                  <option value="unmarked">Not Checked In</option>
                                </select>
                              )}
                              <select
                                value={currentFilters.gender}
                                onChange={(e) => setEventFilters({
                                  ...eventFilters,
                                  [event.id]: { ...currentFilters, gender: e.target.value }
                                })}
                                className="px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                              >
                                <option value="All">All Genders</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                              </select>

                              <select
                                value={currentFilters.ageBracket}
                                onChange={(e) => setEventFilters({
                                  ...eventFilters,
                                  [event.id]: { ...currentFilters, ageBracket: e.target.value }
                                })}
                                className="px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                              >
                                <option value="All">All Age Brackets</option>
                                <option value="Youth (1-17)">Youth (1-17)</option>
                                <option value="Adult (18-59)">Adult (18-59)</option>
                                <option value="Senior (60+)">Senior (60+)</option>
                              </select>
                            </div>
                          </div>

                          {filteredList.length === 0 ? (
                            <div className="p-10 text-center text-slate-400 text-xs font-bold uppercase tracking-wider bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                              {emptyText}
                            </div>
                          ) : (
                            <div className="border border-slate-200 rounded-xl overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 font-bold uppercase text-[11px] text-slate-500 border-b border-slate-200">
                                  <tr>
                                    {isOfficialOrAttendanceTab && <th className="p-3.5">Serial ID</th>}
                                    <th className="p-3.5">Participant Name</th>
                                    <th className="p-3.5">Contact Info</th>
                                    <th className="p-3.5">Gender</th>
                                    <th className="p-3.5">Age</th>
                                    <th className="p-3.5">Home Address</th>
                                    <th className="p-3.5">Registered Date</th>
                                    {(showPaymentTabs || tab === "refunded") && <th className="p-3.5">Payment</th>}
                                    {isOfficialOrAttendanceTab && <th className="p-3.5">Attendance</th>}
                                    {tab === "rejected" && <th className="p-3.5">Reason</th>}
                                    {tab !== "rejected" && <th className="p-3.5 text-right">Actions</th>}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                                  {filteredList.map((a) => {
                                    const serialId = resolveRegistrationSerial(a);
                                    const attendance = resolveAttendanceState(a);
                                    const attMeta = attendanceBadgeMeta(attendance);
                                    const refundState = resolveRefundState(a);

                                    return (
                                      <tr
                                        key={a.id}
                                        className={`hover:bg-slate-50/70 transition-colors ${
                                          refundState === "requested" ? "bg-amber-50/60" : ""
                                        }`}
                                      >
                                        {isOfficialOrAttendanceTab && (
                                          <td className="p-3.5 font-mono text-[11px] font-black text-blue-950 whitespace-nowrap">
                                            {serialId || "—"}
                                          </td>
                                        )}
                                        <td className="p-3.5 font-bold text-slate-900">
                                          {a.first_name} {a.last_name}
                                          {refundState === "requested" && (
                                            <span className="block w-fit mt-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black uppercase">
                                              Refund Requested
                                            </span>
                                          )}
                                          {a.team_name && (
                                            <span className="block text-[10px] font-bold text-indigo-700 mt-0.5">
                                              Team: {a.team_name} ({teamMembersOf(a).length} members){" "}
                                              <button type="button" onClick={() => setViewingTeam(a)} className="text-blue-600 hover:underline">
                                                View team
                                              </button>
                                            </span>
                                          )}
                                        </td>
                                        <td className="p-3.5">
                                          <span>{a.email}</span>
                                          <span className="block text-[10px] text-slate-400 mt-0.5">{a.phone_number}</span>
                                        </td>
                                        <td className="p-3.5 font-bold">{a.gender}</td>
                                        <td className="p-3.5 font-bold">{a.age} yrs</td>
                                        <td className="p-3.5 max-w-[200px] truncate" title={a.home_address}>{a.home_address}</td>
                                        <td className="p-3.5">{new Date(a.created_at).toLocaleDateString()}</td>
                                        {(showPaymentTabs || tab === "refunded") && (
                                          <td className="p-3.5">
                                            <span className="font-bold text-slate-800">{a.payment_method || "N/A"}</span>
                                            {a.amount_due ? <span className="text-slate-500"> {peso(a.amount_due)}</span> : null}
                                            {a.payment_reference && (
                                              <span className="block text-[10px] text-slate-500 mt-0.5">Ref: {a.payment_reference}</span>
                                            )}
                                            {a.payment_proof_url && (
                                              <button
                                                type="button"
                                                onClick={() => setViewerSrc(a.payment_proof_url)}
                                                className="block text-[10px] font-bold text-blue-600 hover:underline mt-0.5"
                                              >
                                                View receipt
                                              </button>
                                            )}
                                            {refundState === "refunded" && (
                                              <span className="block w-fit mt-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase">
                                                Refunded {a.refunded_at ? `• ${new Date(a.refunded_at).toLocaleDateString()}` : ""}
                                              </span>
                                            )}
                                          </td>
                                        )}
                                        {isOfficialOrAttendanceTab && (
                                          <td className="p-3.5 whitespace-nowrap">
                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${attMeta.cls}`}>
                                              {attMeta.label}
                                            </span>
                                          </td>
                                        )}
                                        {tab === "rejected" && <td className="p-3.5 text-red-700">{a.rejection_reason || "-"}</td>}
                                        {tab !== "rejected" && (
                                          <td className="p-3.5 text-right whitespace-nowrap">
                                            <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                                              {tab === "refunded" ? (
                                                <button
                                                  type="button"
                                                  onClick={() => revertRefundForAttendee(a)}
                                                  disabled={busyRegId === a.id}
                                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 rounded-lg font-bold text-[10px] uppercase transition-all"
                                                >
                                                  Revert Refund
                                                </button>
                                              ) : regState(a) === "pending" ? (
                                                <>
                                                  <button
                                                    onClick={() => confirmRegistration(a)}
                                                    disabled={busyRegId === a.id}
                                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg font-bold text-[10px] uppercase shadow-xs transition-all"
                                                  >
                                                    Confirm payment
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setRejectRegReason("");
                                                      setRejectingReg(a);
                                                    }}
                                                    disabled={busyRegId === a.id}
                                                    className="px-2.5 py-1.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 rounded-lg font-bold text-[10px] uppercase transition-all"
                                                  >
                                                    Reject
                                                  </button>
                                                </>
                                              ) : (
                                                <>
                                                  {(event.is_paid || refundState === "requested" || isCancelledOrRescheduled) && (
                                                    <button
                                                      type="button"
                                                      onClick={() => confirmRefundForAttendee(a)}
                                                      disabled={busyRegId === a.id}
                                                      className="px-3 py-1.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg font-bold text-[10px] uppercase shadow-xs transition-all"
                                                    >
                                                      Confirm Refund
                                                    </button>
                                                  )}
                                                  {attendance !== "confirmed" ? (
                                                    <button
                                                      onClick={() => confirmAttendeePresence(a)}
                                                      disabled={busyRegId === a.id}
                                                      className={`px-3 py-1.5 disabled:opacity-60 text-white rounded-lg font-bold text-[10px] uppercase shadow-xs transition-all ${
                                                        attendance === "marked"
                                                          ? "bg-emerald-600 hover:bg-emerald-700"
                                                          : "bg-blue-900 hover:bg-blue-800"
                                                      }`}
                                                    >
                                                      {attendance === "marked" ? "Confirm Check-In" : "Mark Present"}
                                                    </button>
                                                  ) : (
                                                    <button
                                                      onClick={() => revertAttendeePresence(a)}
                                                      disabled={busyRegId === a.id}
                                                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 rounded-lg font-bold text-[10px] uppercase transition-all"
                                                    >
                                                      Undo Present
                                                    </button>
                                                  )}
                                                  {showPaymentTabs && (
                                                    <button
                                                      onClick={() => moveToPending(a)}
                                                      disabled={busyRegId === a.id}
                                                      className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg font-bold text-[10px] uppercase transition-all"
                                                    >
                                                      Move to pending
                                                    </button>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Notifications & Updates</h1>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">Review decisions from the Tourism Office on your events.</p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap self-start md:self-auto"
              >
                ← Overview
              </button>
            </div>
            <div className="space-y-3">
              {visibleNotifications.length === 0 && (
                <div className="bg-white p-14 rounded-2xl border border-dashed border-slate-200 text-center text-slate-400 text-xs font-bold uppercase tracking-wider">
                  No notifications to display.
                </div>
              )}
              {visibleNotifications.map((event) => {
                const status = (event.status || "Pending").toLowerCase();
                const actionMeta = parseEventActionMeta(event);
                const messages = {
                  pending: "Your proposal is waiting for review by the Tourism Office.",
                  "under review": "Your proposal is being reviewed by the Tourism Office.",
                  approved: "Approved. Your event is now listed on the public schedule.",
                  upcoming: "Approved. Your event is now listed on the public schedule.",
                  ongoing: "Your event is currently running.",
                  completed: "This event has been marked as completed.",
                  rejected: "Your proposal was rejected.",
                  "requires changes": "The Tourism Office asked for changes before approval.",
                  "requirements needed": "The Tourism Office sent an approval letter. Complete the listed requirements so your event can be published.",
                  "requirements submitted": "Your requirements were sent. Waiting for the Tourism Office to review them.",
                  "cancellation requested": "Your cancellation request is waiting for admin approval.",
                  cancelled: "This event has been cancelled. Registered attendees remain available under Attendees and payments so you can coordinate refunds.",
                  "reschedule requested": "Your event rescheduling request is waiting for admin approval.",
                  rescheduled: "Your event rescheduling has been approved. Joined tourists have been notified and may choose to attend or request a refund.",
                };
                const note = status === "requirements needed" ? event.approval_instructions : actionMeta.action_reason || event.revision_notes || event.rejection_reason;

                return (
                  <div
                    key={event.id}
                    className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-start justify-between gap-4 transition-all hover:border-slate-300"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase tracking-wider ${statusBadge(event.status)}`}>
                          {event.status || "Pending"}
                        </span>
                        {event.created_at && (
                          <span className="text-[11px] text-slate-400 font-semibold">{new Date(event.created_at).toLocaleDateString()}</span>
                        )}
                      </div>
                      <p className="text-sm font-black text-slate-900">{event.event_name}</p>
                      <p className="text-xs text-slate-600">{messages[status] || "Status updated by the Tourism Office."}</p>
                      {note && !["approved", "upcoming", "ongoing", "completed"].includes(status) && (
                        <div className="text-xs text-purple-800 bg-purple-50/90 border border-purple-200/70 rounded-xl p-3 mt-2 space-y-1">
                          <p><strong>Details / Admin note:</strong> {note}</p>
                          {actionMeta.organizer_contact_info && (
                            <p className="text-[11px] text-blue-900 font-semibold">
                              Tourist Support Contact: {actionMeta.organizer_contact_info}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDismissNotification(event.id)}
                      className="px-3.5 py-1.5 text-[11px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 hover:text-slate-800 rounded-xl transition-colors shrink-0 uppercase tracking-wider"
                    >
                      Dismiss
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Organizer Verification Profile</h1>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">Your official registered entity information.</p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap self-start md:self-auto"
              >
                ← Overview
              </button>
            </div>

            <div className="max-w-2xl mx-auto py-2">
              <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-8 text-center space-y-6">
                <div className="flex flex-col items-center space-y-3">
                  {profile?.logo_url ? (
                    <img
                      src={profile.logo_url}
                      alt="Organization Logo"
                      className="w-24 h-24 object-cover rounded-2xl shadow-md border border-slate-100"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-2xl bg-blue-900 text-white font-black text-3xl flex items-center justify-center shadow-md uppercase">
                      {profile?.organization?.[0] || profile?.full_name?.[0] || "O"}
                    </div>
                  )}
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {profile?.organization || profile?.full_name || "Organizer Profile"}
                    </h2>
                    <p className="text-xs font-semibold text-slate-500 mt-1">{profile?.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-left border-t border-slate-100 pt-6">
                  <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Representative Full Name</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{profile?.organizer_full_name || profile?.full_name || "Not provided"}</p>
                  </div>
                  <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact Phone</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{profile?.contact_number || "Not provided"}</p>
                  </div>
                  <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Organization Type</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{profile?.org_type || "Not provided"}</p>
                  </div>
                  <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Office / Home Address</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{profile?.address || "Not provided"}</p>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-6 text-left">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3.5">Verification Documents</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                    {profile?.business_permit_no ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-600 uppercase">Business Permit</p>
                        {profile.business_permit_no.startsWith("data:image") || profile.business_permit_no.startsWith("http") ? (
                          <button type="button" onClick={() => setViewerSrc(profile.business_permit_no)} className="w-full group">
                            <img
                              src={profile.business_permit_no}
                              alt="Business Permit"
                              className="w-full h-24 object-cover rounded-xl border border-slate-200 shadow-xs group-hover:opacity-90 transition-opacity"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center p-2 text-center text-xs font-bold text-slate-700 overflow-hidden break-all">
                            {profile.business_permit_no}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5 opacity-55">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Business Permit</p>
                        <div className="w-full h-24 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase">
                          N/A
                        </div>
                      </div>
                    )}

                    {profile?.bir_tin ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-600 uppercase">BIR TIN</p>
                        {profile.bir_tin.startsWith("data:image") || profile.bir_tin.startsWith("http") ? (
                          <button type="button" onClick={() => setViewerSrc(profile.bir_tin)} className="w-full group">
                            <img
                              src={profile.bir_tin}
                              alt="BIR TIN"
                              className="w-full h-24 object-cover rounded-xl border border-slate-200 shadow-xs group-hover:opacity-90 transition-opacity"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center p-2 text-center text-xs font-bold text-slate-700 overflow-hidden break-all">
                            {profile.bir_tin}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5 opacity-55">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">BIR TIN</p>
                        <div className="w-full h-24 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase">
                          N/A
                        </div>
                      </div>
                    )}

                    {profile?.dti_sec_reg ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-600 uppercase">DTI / SEC</p>
                        {profile.dti_sec_reg.startsWith("data:image") || profile.dti_sec_reg.startsWith("http") ? (
                          <button type="button" onClick={() => setViewerSrc(profile.dti_sec_reg)} className="w-full group">
                            <img
                              src={profile.dti_sec_reg}
                              alt="DTI SEC Reg"
                              className="w-full h-24 object-cover rounded-xl border border-slate-200 shadow-xs group-hover:opacity-90 transition-opacity"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center p-2 text-center text-xs font-bold text-slate-700 overflow-hidden break-all">
                            {profile.dti_sec_reg}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5 opacity-55">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">DTI / SEC</p>
                        <div className="w-full h-24 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase">
                          N/A
                        </div>
                      </div>
                    )}

                    {profile?.valid_id_url ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-600 uppercase">Valid ID</p>
                        <button type="button" onClick={() => setViewerSrc(profile.valid_id_url)} className="w-full group">
                          <img
                            src={profile.valid_id_url}
                            alt="Valid ID"
                            className="w-full h-24 object-cover rounded-xl border border-slate-200 shadow-xs group-hover:opacity-90 transition-opacity"
                          />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5 opacity-55">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Valid ID</p>
                        <div className="w-full h-24 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase">
                          N/A
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Account & Security Settings</h1>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">Manage your organizer login credentials.</p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap self-start md:self-auto"
              >
                ← Overview
              </button>
            </div>
            <div className="bg-white p-8 rounded-3xl border border-slate-200/90 max-w-md space-y-5 text-xs font-semibold shadow-sm">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Registered Email</label>
                <input
                  type="email"
                  disabled
                  value={newEmail}
                  className="w-full p-3.5 bg-slate-100 border border-slate-200/70 rounded-xl font-bold text-slate-600 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">New Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                />
              </div>
              <button
                onClick={async () => {
                  if (!newPassword) return notify("Please enter a new password first.", "info");
                  const { error } = await supabase.auth.updateUser({ password: newPassword });
                  if (error) {
                    notify("Error updating password: " + error.message);
                  } else {
                    setNewPassword("");
                    setPwSaved(true);
                    setTimeout(() => setPwSaved(false), 2000);
                  }
                }}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase tracking-wider shadow-sm transition-all"
              >
                {pwSaved ? "Saved ✓" : "Save Account Settings"}
              </button>
            </div>
          </div>
        )}
      </DashboardShell>

      {calendarSelectedEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto border border-slate-100 text-xs font-semibold">
            <div className="flex justify-between items-start gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2.5 py-0.5 text-[10px] font-black rounded-full uppercase ${statusBadge(calendarSelectedEvent.status)}`}>
                    {calendarSelectedEvent.status || "Official"}
                  </span>
                  <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase bg-slate-100 text-slate-600">
                    {REG_TYPE_LABEL[regTypeOf(calendarSelectedEvent)]}
                  </span>
                </div>
                <h3 className="text-lg font-black text-slate-900 mt-2">{calendarSelectedEvent.event_name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setCalendarSelectedEvent(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold whitespace-nowrap transition-colors"
              >
                Close
              </button>
            </div>

            {getImageList(calendarSelectedEvent.image_url).length > 0 && (
              <ImageCarousel
                images={getImageList(calendarSelectedEvent.image_url)}
                onPreview={setViewerSrc}
                className="w-full h-44 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200"
              />
            )}

            <p className="text-slate-600 leading-relaxed whitespace-pre-line">
              {calendarSelectedEvent.description || "No description provided."}
            </p>

            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-1.5 text-slate-700">
              <p><strong>Organizer:</strong> {calendarSelectedEvent.organizer_name || "Municipal Tourism"}</p>
              <p><strong>Venue:</strong> {calendarSelectedEvent.venue || "TBA"}</p>
              <p>
                <strong>Date:</strong> {calendarSelectedEvent.event_date || "TBA"}
                {calendarSelectedEvent.event_end_date && calendarSelectedEvent.event_end_date !== calendarSelectedEvent.event_date
                  ? ` to ${calendarSelectedEvent.event_end_date}`
                  : ""}
              </p>
              <p><strong>Time:</strong> {formatTimeRange(calendarSelectedEvent) || "TBA"}</p>
              <p><strong>Fee:</strong> {calendarSelectedEvent.is_paid ? peso(calendarSelectedEvent.fee_amount) : "Free"}</p>
            </div>
          </div>
        </div>
      )}

      {viewingTeam && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-8 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto border border-slate-100">
            <div className="flex justify-between items-start gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase">Team details</h3>
                <p className="text-xs text-slate-500 font-medium">Everything this team submitted when it registered.</p>
              </div>
              <button
                onClick={() => setViewingTeam(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold whitespace-nowrap transition-colors"
              >
                Close
              </button>
            </div>
            <TeamDetails registration={viewingTeam} onPreview={setViewerSrc} />
          </div>
        </div>
      )}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}

      {requirementsEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto border border-slate-100">
            <div>
              <span className="text-[10px] font-black text-teal-800 bg-teal-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Requirements
              </span>
              <h2 className="text-xl font-black text-slate-900 mt-2.5">Send documents for "{requirementsEvent.event_name}"</h2>
              {requirementsEvent.approval_instructions && (
                <p className="text-xs text-teal-900 bg-teal-50 border border-teal-100 rounded-xl p-3.5 mt-3 font-medium whitespace-pre-line">
                  <strong>Tourism Office instructions:</strong> {requirementsEvent.approval_instructions}
                </p>
              )}
            </div>

            <form onSubmit={handleSubmitRequirements} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Your Statement</label>
                <textarea
                  rows="4"
                  placeholder="e.g. Attached is the approval letter stamped by the Municipal Hall, together with our mayor's permit."
                  value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Documents / Photos</label>
                <FilePicker files={reqFiles} onChange={setReqFiles} label="Attach files" hint="PDF, Word, Excel, images - up to 10MB each" />
              </div>
              {Array.isArray(requirementsEvent.requirement_files) && requirementsEvent.requirement_files.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Already sent (kept)</p>
                  <AttachmentList files={requirementsEvent.requirement_files} onPreview={setViewerSrc} />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={reqSaving}
                  className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  {reqSaving ? "Uploading & sending..." : "Send to Tourism Office"}
                </button>
                <button
                  type="button"
                  onClick={() => setRequirementsEvent(null)}
                  disabled={reqSaving}
                  className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all whitespace-nowrap"
                >
                  ← Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectingReg && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl space-y-5 border border-slate-100">
            <div>
              <span className="text-[10px] font-black text-red-700 bg-red-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Reject Registration
              </span>
              <h2 className="text-lg font-black text-slate-900 mt-2.5">
                {rejectingReg.first_name} {rejectingReg.last_name}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                The participant will see your reason and must resubmit their registration (and payment details).
              </p>
            </div>
            <form onSubmit={handleRejectRegistration} className="space-y-4 text-xs font-semibold">
              <textarea
                rows="3"
                required
                placeholder="e.g. We could not find your GCash payment. Please resubmit with the correct reference number."
                value={rejectRegReason}
                onChange={(e) => setRejectRegReason(e.target.value)}
                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:bg-white transition-all"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={busyRegId === rejectingReg.id}
                  className="w-full py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  Reject registration
                </button>
                <button
                  type="button"
                  onClick={() => setRejectingReg(null)}
                  className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all whitespace-nowrap"
                >
                  ← Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingEvent && (() => {
        const modalDuplicates = findDuplicateEvents(editingEvent, allEvents);
        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-slate-100">
              <div className="p-8 pb-4 flex-shrink-0">
                <span className="text-[10px] font-black text-blue-900 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                  Event Revision Form
                </span>
                <h2 className="text-2xl font-black text-slate-900 mt-2.5">Edit Event Details</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Updating image, description, or schedule will resubmit your event for review.
                </p>
              </div>

              <form onSubmit={handleSaveEventEdit} className="flex flex-col flex-1 overflow-hidden">
                <div className="p-8 pt-2 overflow-y-auto space-y-4 text-xs font-semibold flex-1">
                  {modalDuplicates.length > 0 && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-950 space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                        Warning: Existing Matching Event Detected ({modalDuplicates.length})
                      </p>
                      <p className="font-medium">
                        Matches{" "}
                        {modalDuplicates
                          .map((m) => `"${m.event_name}" (${m.status || "Scheduled"} on ${m.event_date || "TBA"} at ${m.venue || "TBA"})`)
                          .join("; ")}
                        .
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Event Photos / Banner</label>
                    <FilePicker files={editFiles} onChange={setEditFiles} label="Add more photos" hint="Upload event banners or pictures" />
                    {getImageList(editingEvent.image_url).length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Current Photos</p>
                        <ImageCarousel images={getImageList(editingEvent.image_url)} onPreview={setViewerSrc} className="w-full h-32 rounded-xl overflow-hidden bg-slate-100 border border-slate-200" />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Description</label>
                    <textarea
                      rows="3"
                      value={editingEvent.description || ""}
                      onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                      className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Proposed Date *</label>
                      <input
                        type="date"
                        required
                        value={editingEvent.event_date || ""}
                        onChange={(e) => setEditingEvent({ ...editingEvent, event_date: e.target.value })}
                        className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">End Date (optional)</label>
                      <input
                        type="date"
                        value={editingEvent.event_end_date || ""}
                        onChange={(e) => setEditingEvent({ ...editingEvent, event_end_date: e.target.value })}
                        className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <TimePicker
                      label="Start time"
                      required
                      value={editingEvent.event_time || ""}
                      onChange={(v) => setEditingEvent({ ...editingEvent, event_time: v })}
                    />
                    <TimePicker
                      label="End time"
                      optional
                      value={editingEvent.event_end_time || ""}
                      onChange={(v) => setEditingEvent({ ...editingEvent, event_end_time: v })}
                    />
                  </div>
                </div>

                <div className="p-8 pt-4 bg-white border-t border-slate-100 flex gap-3 flex-shrink-0">
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="w-full py-3.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                  >
                    {editSaving ? "Saving & Resubmitting..." : "Save & Resubmit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingEvent(null)}
                    disabled={editSaving}
                    className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all whitespace-nowrap"
                  >
                    ← Back
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {cancelingEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl space-y-6 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div>
              <span className="text-[10px] font-black text-red-700 bg-red-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Event Cancellation
              </span>
              <h2 className="text-xl font-black text-slate-900 mt-2.5">
                Request Cancellation for "{cancelingEvent.event_name}"
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Provide your reason and contact information so registered tourists can reach out to you for refunds or inquiries. This request awaits admin approval.
              </p>
            </div>

            <form onSubmit={handleRequestCancellation} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Cancellation Reason *</label>
                <textarea
                  rows="3"
                  required
                  placeholder="State why this approved event must be cancelled..."
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Organizer Contact Information for Refunds & Inquiries *
                </label>
                <textarea
                  rows="3"
                  required
                  placeholder="e.g. Mobile: 0917 123 4567 | Email: organizer@email.com | Messenger / Page: @DaetEvents"
                  value={cancellationContact}
                  onChange={(e) => setCancellationContact(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  Tourists will see this contact information alongside their Serial ID to request a refund.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="w-full py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  {submittingAction ? "Submitting..." : "Submit Request"}
                </button>
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => {
                    setCancelingEvent(null);
                    setCancellationReason("");
                    setCancellationContact("");
                  }}
                  className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all whitespace-nowrap"
                >
                  ← Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reschedulingEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl space-y-5 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div>
              <span className="text-[10px] font-black text-blue-900 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Event Rescheduling
              </span>
              <h2 className="text-xl font-black text-slate-900 mt-2.5">
                Request Rescheduling for "{reschedulingEvent.event_name}"
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Submit your proposed new schedule, reason, and contact details for admin approval. Once approved, joined tourists will be notified and can choose to continue or request a refund.
              </p>
            </div>

            <form onSubmit={handleRequestReschedule} className="space-y-4 text-xs font-semibold">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Proposed New Start Date *</label>
                  <input
                    type="date"
                    required
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">New End Date (optional)</label>
                  <input
                    type="date"
                    value={rescheduleEndDate}
                    onChange={(e) => setRescheduleEndDate(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <TimePicker
                  label="New Start Time"
                  required
                  value={rescheduleTime}
                  onChange={setRescheduleTime}
                />
                <TimePicker
                  label="New End Time"
                  optional
                  value={rescheduleEndTime}
                  onChange={setRescheduleEndTime}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Reason for Rescheduling *</label>
                <textarea
                  rows="3"
                  required
                  placeholder="Explain why the event is being rescheduled (tourists will see this explanation once approved)..."
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Organizer Contact Information for Refund Requests *
                </label>
                <textarea
                  rows="3"
                  required
                  placeholder="e.g. Mobile: 0917 123 4567 | Email: organizer@email.com | Messenger / Page: @DaetEvents"
                  value={rescheduleContact}
                  onChange={(e) => setRescheduleContact(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  Tourists who opt out of the rescheduled date will contact you here with their Serial ID to request a refund.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="w-full py-3.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  {submittingAction ? "Submitting..." : "Submit Reschedule Request"}
                </button>
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => {
                    setReschedulingEvent(null);
                    setRescheduleReason("");
                    setRescheduleContact("");
                  }}
                  className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all whitespace-nowrap"
                >
                  ← Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingContactEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl space-y-5 border border-slate-100">
            <div>
              <span className="text-[10px] font-black text-blue-900 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Tourist Refund & Support Contact
              </span>
              <h2 className="text-xl font-black text-slate-900 mt-2.5">{editingContactEvent.event_name}</h2>
              <p className="text-xs text-slate-500 mt-1">
                Provide or update the contact details shown to joined tourists who wish to request a refund or inquire about schedule changes.
              </p>
            </div>

            <form onSubmit={handleSaveOrganizerContact} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Organizer Contact Details *
                </label>
                <textarea
                  rows="4"
                  required
                  placeholder="e.g. Mobile: 0917 123 4567 | Email: organizer@email.com | Messenger / Page: @DaetEvents"
                  value={contactEditValue}
                  onChange={(e) => setContactEditValue(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="w-full py-3.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  {submittingAction ? "Saving..." : "Save Contact Info"}
                </button>
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => setEditingContactEvent(null)}
                  className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all whitespace-nowrap"
                >
                  ← Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}