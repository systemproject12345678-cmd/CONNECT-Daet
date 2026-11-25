"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";
import DashboardShell from "@/components/ui/DashboardShell";
import { FilePicker } from "@/components/ui/Attachments";
import EventCalendar from "@/components/ui/EventCalendar";
import { uploadAttachments, validateFiles, peso, regState } from "@/lib/eventHelpers";
import {
  withLiveStatus,
  useNow,
  formatTime,
  formatTimeRange,
  msUntilStart,
  DAY_MS,
  regTypeOf,
  REG_TYPE_LABEL,
  teamMembersOf,
} from "@/lib/eventSchedule";

const EVENT_THUMB =
  "relative w-full md:w-56 h-44 md:h-40 flex-shrink-0 self-start rounded-xl overflow-hidden bg-stone-100 dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 group";

const TOURIST_REG_OVERRIDE_KEY = "daet_tourist_reg_overrides_v1";

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

const norm = (s) => (typeof s === "string" || typeof s === "number" ? String(s).trim().toLowerCase() : "");

const toEventDateKey = (raw) => {
  if (!raw || typeof raw === "function" || typeof raw === "object") return "";
  const match = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
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

const parseEventActionMeta = (ev) => {
  if (!ev) return {};
  const raw = String(ev.rejection_reason || "");
  const contactMatch = raw.match(/\[CONTACT:\s*([^\]]+)\]/i);
  const reschedMatch = raw.match(/\[RESCHEDULE:\s*([^\]]+)\]/i);
  const cleanReason = raw
    .replace(/\[CONTACT:\s*([^\]]+)\]/gi, "")
    .replace(/\[RESCHEDULE:\s*([^\]]+)\]/gi, "")
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

const parseOrganizerPaymentDetails = (ev) => {
  if (!ev) {
    return {
      onlineDetails: "",
      bankName: "",
      bankAccountName: "",
      bankAccountNumber: "",
      hasBank: false,
      hasOnline: false,
    };
  }

  const rawOnline = String(ev.online_payment_details || "");
  const lines = rawOnline.split(/\r?\n/);

  let parsedBankName = "";
  let parsedAccountName = "";
  let parsedAccountNumber = "";
  const remainingLines = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    const bankLineMatch = trimmed.match(
      /^Bank Payment\s*[—-]\s*Bank:\s*([^|]+)\|\s*Account Name:\s*([^|]+)\|\s*Account Number:\s*(.+)$/i
    );
    if (bankLineMatch) {
      parsedBankName = bankLineMatch[1].trim();
      parsedAccountName = bankLineMatch[2].trim();
      parsedAccountNumber = bankLineMatch[3].trim();
    } else if (trimmed) {
      remainingLines.push(trimmed);
    }
  });

  const bankName = String(ev.bank_name || parsedBankName || "").trim();
  const bankAccountName = String(ev.bank_account_name || parsedAccountName || "").trim();
  const bankAccountNumber = String(ev.bank_account_number || parsedAccountNumber || "").trim();
  const onlineDetails = remainingLines.join("\n").trim();

  return {
    onlineDetails,
    bankName,
    bankAccountName,
    bankAccountNumber,
    hasBank: Boolean(bankName || bankAccountName || bankAccountNumber),
    hasOnline: Boolean(onlineDetails),
  };
};

const resolveRegistrationSerial = (r) => {
  if (!r) return "";
  if (r.serial_id) return String(r.serial_id);
  if (r.ticket_serial) return String(r.ticket_serial);
  if (r.serial_number) return String(r.serial_number);
  if (regState(r) === "confirmed" && r.id != null) {
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

const isMissingColumnError = (err) => {
  const msg = norm(err?.message || "");
  const code = String(err?.code || "");
  return code === "PGRST204" || msg.includes("column") || msg.includes("schema cache");
};

const getPhase = (status) => {
  const st = norm(status);
  if (st === "cancelled") return "Cancelled";
  if (st === "ongoing") return "Ongoing";
  if (st === "completed") return "Completed";
  if (st === "rescheduled") return "Rescheduled";
  return "Upcoming";
};

const phaseBadge = {
  Upcoming: "bg-sky-50 text-sky-800 border border-sky-200/70 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70",
  Ongoing: "bg-emerald-50 text-emerald-800 border border-emerald-200/70 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70",
  Rescheduled: "bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
  Cancelled: "bg-rose-50 text-rose-700 border border-rose-200/70 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70",
  Completed: "bg-stone-100 text-slate-700 border border-stone-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

const formatDate = (v) => {
  if (!v) return "TBA";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};

export default function TouristDashboardPage() {
  const router = useRouter();
  const { notify, confirm: askConfirm, feedbackUI } = useFeedback();
  const [pwSaved, setPwSaved] = useState(false);

  const [activeTab, setActiveTab] = useState("my-events");

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rawRegistrations, setRegistrations] = useState([]);
  const [regOverrides, setRegOverrides] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem(TOURIST_REG_OVERRIDE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const registrations = useMemo(
    () =>
      rawRegistrations.map((r) => {
        const ov = regOverrides[String(r.id)];
        return ov ? { ...r, ...ov } : r;
      }),
    [rawRegistrations, regOverrides]
  );
  const [rawEventsMap, setEventsMap] = useState({});
  const [rawAllEvents, setRawAllEvents] = useState([]);
  const [interestedRaw, setInterestedRaw] = useState([]);
  const now = useNow(30000);

  const [dismissedNotifs, setDismissedNotifs] = useState(new Set());
  const [hiddenCancelledIds, setHiddenCancelledIds] = useState(() => new Set());
  const [calendarSelectedEvent, setCalendarSelectedEvent] = useState(null);
  const [busyCheckInId, setBusyCheckInId] = useState(null);
  const [busyScheduleChoiceId, setBusyScheduleChoiceId] = useState(null);
  const [copiedSerialId, setCopiedSerialId] = useState("");

  const eventsMap = useMemo(() => {
    const live = {};
    Object.entries(rawEventsMap).forEach(([id, ev]) => {
      live[id] = withLiveStatus(ev, now);
    });
    return live;
  }, [rawEventsMap, now]);

  const allEvents = useMemo(
    () => rawAllEvents.map((ev) => withLiveStatus(ev, now)),
    [rawAllEvents, now]
  );

  const interestedEvents = useMemo(
    () => interestedRaw.map((ev) => withLiveStatus(ev, now)),
    [interestedRaw, now]
  );

  const [eventsFetchOk, setEventsFetchOk] = useState(true);
  const [viewerSrc, setViewerSrc] = useState(null);

  const [resubmitReg, setResubmitReg] = useState(null);
  const [resubForm, setResubForm] = useState({ method: "cash", reference: "" });
  const [resubProof, setResubProof] = useState([]);
  const [resubSaving, setResubSaving] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const persistRegOverride = (regId, patch) => {
    setRegOverrides((prev) => {
      const key = String(regId);
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      try {
        window.localStorage.setItem(TOURIST_REG_OVERRIDE_KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const handleCopySerial = async (serialText, label = "Serial ID") => {
    if (!serialText) return;
    try {
      await navigator.clipboard.writeText(serialText);
      setCopiedSerialId(serialText);
      setTimeout(() => setCopiedSerialId(""), 2000);
    } catch (e) {
      notify(`${label}: ${serialText}`, "info");
    }
  };

  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
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

      setProfile(userProfile);

      const { data: allProgramsData } = await supabase
        .from("tourism_programs")
        .select("*")
        .order("created_at", { ascending: false });

      setRawAllEvents(allProgramsData || []);

      const { data: regsData, error: regErr } = await supabase
        .from("event_registrations")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (regErr) {
        console.error("Error fetching registrations:", regErr.message);
      }

      const userRegs = regsData || [];

      setRegOverrides((prev) => {
        if (!prev || Object.keys(prev).length === 0) return prev;
        let changed = false;
        const next = { ...prev };
        userRegs.forEach((row) => {
          const key = String(row.id);
          const cached = next[key];
          if (!cached) return;
          const liveStatus = norm(row.registration_status);
          const cachedStatus = norm(cached.registration_status);
          if (
            (cachedStatus === "resubmitted" || cachedStatus === "pending") &&
            (liveStatus === "confirmed" || liveStatus === "rejected")
          ) {
            delete next[key];
            changed = true;
          }
        });
        if (changed) {
          try {
            window.localStorage.setItem(TOURIST_REG_OVERRIDE_KEY, JSON.stringify(next));
          } catch (e) {}
          return next;
        }
        return prev;
      });

      setRegistrations(userRegs);

      const eventIds = [...new Set(userRegs.map((r) => r.event_id))];
      if (eventIds.length > 0) {
        const { data: eventsData, error: evErr } = await supabase
          .from("tourism_programs")
          .select("*")
          .in("id", eventIds);

        setEventsFetchOk(!evErr);

        const map = {};
        (eventsData || []).forEach((ev) => {
          map[ev.id] = ev;
        });
        setEventsMap(map);
      } else {
        setEventsMap({});
      }

      const { data: interestRows, error: interestErr } = await supabase
        .from("interested_events")
        .select("event_id")
        .eq("user_id", session.user.id);
      if (interestErr) console.warn("Interested events warning:", interestErr.message);

      const interestedIds = (interestRows || []).map((r) => r.event_id);
      if (interestedIds.length > 0) {
        const { data: interestedData } = await supabase
          .from("tourism_programs")
          .select("*")
          .in("id", interestedIds);
        setInterestedRaw((interestedData || []).filter((ev) => norm(ev.status) !== "cancelled"));
      } else {
        setInterestedRaw([]);
      }
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel("tourist-dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tourism_programs" }, () => fetchData(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, () => fetchData(true))
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/programs");
  };

  const handleCancelRegistration = async (registrationId) => {
    const reg = registrations.find((r) => r.id === registrationId);
    const eventName = eventsMap[reg?.event_id]?.event_name || "this event";

    const ok = await askConfirm({
      title: "Cancel your registration?",
      message: `You will be removed from the participant list of "${eventName}".`,
      confirmLabel: "Yes, cancel registration",
      cancelLabel: "Keep registration",
      tone: "danger",
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("event_registrations")
        .delete()
        .eq("id", registrationId)
        .eq("user_id", user.id);

      if (error) throw error;

      setRegistrations((prev) => prev.filter((r) => r.id !== registrationId));
      await fetchData(true);
    } catch (err) {
      console.error("Cancel registration error:", err);
      notify("Error cancelling registration: " + err.message);
    }
  };

  const handleContinueRescheduledEvent = async (reg) => {
    const event = eventsMap[reg.event_id] || {};
    const ok = await askConfirm({
      title: "Continue with the rescheduled date?",
      message: `Confirm that you will still attend "${event.event_name || "this event"}" on ${formatDate(event.event_date || event.date)}${formatTimeRange(event) ? ` (${formatTimeRange(event)})` : ""}? Your Serial ID remains active.`,
      confirmLabel: "Yes, continue attending",
    });
    if (!ok) return;

    setBusyScheduleChoiceId(reg.id);
    const patch = {
      reschedule_choice: "continued",
      reschedule_responded_at: new Date().toISOString(),
    };
    try {
      const { error } = await supabase
        .from("event_registrations")
        .update(patch)
        .eq("id", reg.id)
        .eq("user_id", user.id);

      if (error && !isMissingColumnError(error)) throw error;
      persistRegOverride(reg.id, patch);
      setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, ...patch } : r)));
      notify("Confirmed! You remain on the official attendee list for the new schedule.", "info");
    } catch (err) {
      console.error("Continue rescheduled event error:", err);
      notify("Error saving your choice: " + (err.message || "Unknown error"));
    } finally {
      setBusyScheduleChoiceId(null);
    }
  };

  const handleRequestRefund = async (reg) => {
    const event = eventsMap[reg.event_id] || {};
    const actionMeta = parseEventActionMeta(event);
    const serialId = resolveRegistrationSerial(reg);
    const contactText = actionMeta.organizer_contact_info || event.organizer_name || "the event organizer";

    const ok = await askConfirm({
      title: "Request a refund for this event?",
      message: `Your refund request will be flagged for "${event.event_name || "this event"}". Please contact ${contactText} and provide your Serial ID${serialId ? ` (${serialId})` : ""} so the organizer can verify and process your refund.`,
      confirmLabel: "Submit refund request",
      tone: "danger",
    });
    if (!ok) return;

    setBusyScheduleChoiceId(reg.id);
    const nowIso = new Date().toISOString();
    const patch = {
      refund_status: "Requested",
      refund_requested_at: nowIso,
      reschedule_choice: "refund_requested",
    };

    try {
      const { error } = await supabase
        .from("event_registrations")
        .update({
          refund_status: "Requested",
          refund_requested_at: nowIso,
          reschedule_choice: "refund_requested",
        })
        .eq("id", reg.id)
        .eq("user_id", user.id);

      if (error && !isMissingColumnError(error)) throw error;

      persistRegOverride(reg.id, patch);
      setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, ...patch } : r)));
      notify(
        `Refund request recorded. Contact ${contactText} with Serial ID ${serialId || "on your ticket"} to complete your refund.`,
        "info"
      );
    } catch (err) {
      console.error("Request refund error:", err);
      notify("Error requesting refund: " + (err.message || "Unknown error"));
    } finally {
      setBusyScheduleChoiceId(null);
    }
  };

  const handleTouristCheckIn = async (reg) => {
    const event = eventsMap[reg.event_id] || {};
    const serialId = resolveRegistrationSerial(reg);
    const ok = await askConfirm({
      title: "Mark yourself present at this event?",
      message: `Confirm your attendance check-in for "${event.event_name || "this event"}"${serialId ? ` with Serial ID ${serialId}` : ""}? The event organizer will see your check-in and confirm your presence.`,
      confirmLabel: "Yes, I am present",
    });
    if (!ok) return;

    setBusyCheckInId(reg.id);
    const patch = {
      attendance_status: "Marked",
      checked_in_at: new Date().toISOString(),
    };
    try {
      const { error } = await supabase
        .from("event_registrations")
        .update(patch)
        .eq("id", reg.id)
        .eq("user_id", user.id);

      if (error) {
        if (isMissingColumnError(error)) {
          persistRegOverride(reg.id, patch);
          setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, ...patch } : r)));
          notify("Attendance check-in recorded. Present your Serial ID to the organizer for verification.");
          return;
        }
        throw error;
      }

      persistRegOverride(reg.id, patch);
      setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, ...patch } : r)));
      notify("Attendance check-in sent! The organizer can now confirm your presence.");
    } catch (err) {
      console.error("Tourist check-in error:", err);
      notify("Error recording attendance check-in: " + (err.message || "Unknown error"));
    } finally {
      setBusyCheckInId(null);
    }
  };

  const handleUndoTouristCheckIn = async (reg) => {
    const ok = await askConfirm({
      title: "Cancel attendance check-in?",
      message: "Remove your pending attendance check-in for this ongoing event?",
      confirmLabel: "Remove check-in",
      tone: "danger",
    });
    if (!ok) return;

    setBusyCheckInId(reg.id);
    const patch = {
      attendance_status: null,
      checked_in_at: null,
    };
    try {
      const { error } = await supabase
        .from("event_registrations")
        .update(patch)
        .eq("id", reg.id)
        .eq("user_id", user.id);

      if (error && !isMissingColumnError(error)) throw error;
      persistRegOverride(reg.id, patch);
      setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, ...patch } : r)));
    } catch (err) {
      console.error("Undo check-in error:", err);
      notify("Error updating attendance check-in: " + (err.message || "Unknown error"));
    } finally {
      setBusyCheckInId(null);
    }
  };

  const openResubmit = (reg) => {
    const ev = eventsMap[reg.event_id] || {};
    const meta = parseOrganizerPaymentDetails(ev);
    const wasOnline = (reg.payment_method || "").toLowerCase() === "online";
    const defaultDigital = meta.hasBank && !meta.hasOnline ? "bank" : "online";
    setResubForm({
      method: wasOnline ? defaultDigital : "cash",
      reference: reg.payment_reference || "",
    });
    setResubProof([]);
    setResubmitReg(reg);
  };

  const handleResubmit = async () => {
    const reg = resubmitReg;
    const event = eventsMap[reg.event_id] || {};
    const isDigitalPayment = resubForm.method === "online" || resubForm.method === "bank";
    const method = isDigitalPayment ? "Online" : "Cash";

    if (event.is_paid && isDigitalPayment && !resubForm.reference.trim() && resubProof.length === 0 && !reg.payment_proof_url) {
      return notify(
        resubForm.method === "bank"
          ? "For bank payments, please enter your payment reference number or attach a screenshot of your receipt."
          : "For online payments, please enter your payment reference number or attach a screenshot of your receipt."
      );
    }
    const proofError = validateFiles(resubProof);
    if (proofError) return notify(proofError);

    setResubSaving(true);
    try {
      let proofUrl = reg.payment_proof_url || null;
      if (isDigitalPayment && resubProof.length > 0) {
        const [uploaded] = await uploadAttachments(resubProof, `payment-proofs/${user.id}`);
        proofUrl = uploaded.url;
      }

      const basePatch = {
        payment_method: method,
        payment_reference: isDigitalPayment ? resubForm.reference.trim() || null : null,
        payment_proof_url: isDigitalPayment ? proofUrl : null,
        rejection_reason: null,
      };

      let { data: updatedRows, error } = await supabase
        .from("event_registrations")
        .update({
          ...basePatch,
          registration_status: "Resubmitted",
        })
        .eq("id", reg.id)
        .eq("user_id", user.id)
        .select();

      if (error && norm(error.message).includes("check")) {
        ({ data: updatedRows, error } = await supabase
          .from("event_registrations")
          .update({
            ...basePatch,
            registration_status: "Pending",
          })
          .eq("id", reg.id)
          .eq("user_id", user.id)
          .select());
      }

      if (error) throw error;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error("Your resubmission could not be saved. Please refresh the page and try again.");
      }

      const savedRow = updatedRows[0];
      persistRegOverride(reg.id, savedRow);
      setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, ...savedRow } : r)));
      setResubmitReg(null);
      notify("Registration resubmitted! Waiting for the organizer to verify your payment.", "info");
      await fetchData(true);
    } catch (err) {
      console.error("Resubmit registration error:", err);
      notify("Error resubmitting registration: " + (err.message || "Unknown error"));
    } finally {
      setResubSaving(false);
    }
  };

  const dismissNotification = (id) => {
    setDismissedNotifs((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const visibleRegistrations = registrations.filter((reg) => {
    const ev = eventsMap[reg.event_id];
    if (!ev) return !eventsFetchOk;
    if (norm(ev.status) === "cancelled" && hiddenCancelledIds.has(String(reg.id))) return false;
    return true;
  });

  const duplicatesByEventId = useMemo(() => {
    const map = new Map();
    allEvents.forEach((ev) => {
      const matches = findDuplicateEvents(ev, allEvents);
      if (matches.length > 0) map.set(String(ev.id), matches);
    });
    return map;
  }, [allEvents]);

  const removeInterest = async (eventId) => {
    if (!user?.id) return;
    const { error } = await supabase.from("interested_events").delete().eq("user_id", user.id).eq("event_id", eventId);
    if (error) {
      console.error("Remove interest error:", error);
      notify("Could not remove this event: " + error.message);
      return;
    }
    setInterestedRaw((prev) => prev.filter((ev) => String(ev.id) !== String(eventId)));
  };

  const upcomingInterested = interestedEvents
    .filter((ev) => getPhase(ev.status) !== "Completed" && norm(ev.status) !== "cancelled")
    .sort((a, b) => (msUntilStart(a, now) ?? Infinity) - (msUntilStart(b, now) ?? Infinity));

  const reminders = upcomingInterested.filter((ev) => {
    if (getPhase(ev.status) === "Ongoing") return true;
    const diff = msUntilStart(ev, now);
    return diff !== null && diff > 0 && diff <= DAY_MS;
  });

  const activeRemindersCount = reminders.filter((ev) => !dismissedNotifs.has(`reminder-${ev.id}`)).length;
  const activeRegsNotifsCount = visibleRegistrations.filter((reg) => !dismissedNotifs.has(`reg-notif-${reg.id}`)).length;
  const totalActiveNotifications = activeRemindersCount + activeRegsNotifsCount;

  const startsLabel = (ev) => {
    if (getPhase(ev.status) === "Ongoing") return "Happening now";
    const diff = msUntilStart(ev, now);
    if (diff === null) return "Date to be announced";
    if (diff <= 0) return "Starting now";
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) return `Starts in ${Math.max(1, Math.round(diff / 60000))} min`;
    if (diff <= DAY_MS) return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.ceil(diff / DAY_MS);
    return `Starts in ${days} day${days === 1 ? "" : "s"}`;
  };

  const BackButton = ({ to = "my-events", label = "Back to My Events" }) => (
    <button
      onClick={() => setActiveTab(to)}
      className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-slate-700 border border-stone-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap shadow-sm text-center"
    >
      ← {label}
    </button>
  );

  const accountRows = [
    ["Full name", profile?.full_name],
    ["Email address", user?.email || profile?.email],
    ["Phone number", profile?.contact_number || profile?.phone_number || profile?.phone],
    ["Age", profile?.age],
    ["Sex / gender", profile?.sex || profile?.gender],
    ["Civil status", profile?.civil_status],
    ["Home address", profile?.home_address || profile?.address],
    ["Account type", profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : "Tourist"],
    ["Verification status", profile?.status],
    ["Member since", user?.created_at ? formatDate(user.created_at) : profile?.created_at ? formatDate(profile.created_at) : null],
  ];

  if (loading) {
    return (
      <div className="daet-ui min-h-[60vh] flex flex-col items-center justify-center gap-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
        <div className="w-7 h-7 border-2 border-stone-300 border-t-slate-700 dark:border-slate-700 dark:border-t-slate-200 rounded-full animate-spin" />
        <span>Loading tourist portal...</span>
      </div>
    );
  }

  return (
    <div className="daet-ui">
      <DashboardShell
        roleLabel="Tourist portal"
        name={profile?.full_name || "Tourist account"}
        subtitle={user?.email}
        activeKey={activeTab}
        onNavigate={setActiveTab}
        nav={[
          { key: "my-events", label: "My events", icon: "ticket" },
          { key: "interested", label: "Interested events", icon: "calendar-check", badge: upcomingInterested.length, tone: "blue" },
          { key: "calendar", label: "Event calendar", icon: "calendar" },
          { key: "notifications", label: "Notifications", icon: "bell", badge: totalActiveNotifications, tone: "blue" },
          { key: "account", label: "Account details", icon: "user" },
          { key: "settings", label: "Account settings", icon: "settings" },
        ]}
        primaryAction={{ label: "Explore events", href: "/programs" }}
        onLogout={handleLogout}
      >
        {activeTab === "my-events" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">My Registered Events</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                  View your official Serial IDs, respond to schedule changes, check in when events are happening now, and manage your registrations.
                </p>
              </div>
              <Link href="/programs">
                <button className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-xl font-bold text-xs transition-all shadow-sm">
                  Browse More Events →
                </button>
              </Link>
            </div>

            {visibleRegistrations.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 text-center space-y-3 shadow-sm">
                <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase">You haven't registered for any active events yet.</p>
                <Link href="/programs">
                  <button className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-xl font-bold text-xs transition-all shadow-sm">
                    Find an event to join
                  </button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {visibleRegistrations.map((reg) => {
                  const event = eventsMap[reg.event_id] || {};
                  const st = regState(reg);
                  const isResubmitted = norm(reg.registration_status) === "resubmitted" || st === "resubmitted";
                  const isPendingReview = st === "pending" || isResubmitted;
                  const evStatusNorm = norm(event.status);
                  const isCancelled = evStatusNorm === "cancelled";
                  const isRescheduled = evStatusNorm === "rescheduled";
                  const phase = getPhase(event.status);
                  const isOngoing = phase === "Ongoing";
                  const serialId = resolveRegistrationSerial(reg);
                  const refundState = resolveRefundState(reg);
                  const attendance = resolveAttendanceState(reg);
                  const actionMeta = parseEventActionMeta(event);
                  const duplicateMatches = duplicatesByEventId.get(String(reg.event_id)) || [];
                  const resolvedImg = getImageUrl(event.image_url);
                  const startDateVal = event.event_date || event.date;
                  const endDateVal = event.event_end_date || event.end_date;
                  const members = teamMembersOf(reg);
                  const isChoiceBusy = busyScheduleChoiceId === reg.id;

                  return (
                    <div
                      key={reg.id}
                      className={`bg-white dark:bg-slate-900 p-5 rounded-2xl border flex flex-col md:flex-row gap-5 shadow-sm transition-all ${
                        isCancelled
                          ? "border-rose-300 dark:border-rose-800/80"
                          : isRescheduled
                          ? "border-amber-300 dark:border-amber-800/80"
                          : "border-stone-200/90 dark:border-slate-800"
                      }`}
                    >
                      {resolvedImg ? (
                        <button
                          type="button"
                          onClick={() => setViewerSrc(resolvedImg)}
                          className={EVENT_THUMB}
                          aria-label={`View full photo of ${event.event_name}`}
                        >
                          <img
                            src={resolvedImg}
                            alt={event.event_name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.src = "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=600&q=80";
                            }}
                          />
                          <span className="absolute bottom-2 right-2 px-2.5 py-1 bg-black/60 text-white text-[10px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                            View full photo
                          </span>
                        </button>
                      ) : (
                        <div className={`${EVENT_THUMB} flex items-center justify-center text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase`}>
                          No Photo
                        </div>
                      )}

                      <div className="space-y-2.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-base text-slate-900 dark:text-slate-100">{event.event_name || "Municipal Event"}</h3>
                          <span
                            className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${
                              refundState === "refunded"
                                ? "bg-stone-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                                : refundState === "requested"
                                ? "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300"
                                : isResubmitted
                                ? "bg-violet-100 text-violet-900 dark:bg-violet-950/70 dark:text-violet-300"
                                : st === "pending"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                : st === "rejected"
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                            }`}
                          >
                            {refundState === "refunded"
                              ? "Refunded"
                              : refundState === "requested"
                              ? "Refund Requested"
                              : isResubmitted
                              ? "Resubmitted"
                              : st === "pending"
                              ? "Pending approval"
                              : st === "rejected"
                              ? "Rejected"
                              : "Registered"}
                          </span>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${phaseBadge[phase]}`}>
                            {isOngoing ? "Happening now" : phase}
                          </span>
                          {isRescheduled && reg.reschedule_choice === "continued" && refundState === "none" && (
                            <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-300">
                              Continuing with New Schedule
                            </span>
                          )}
                          {st === "confirmed" && attendance === "confirmed" && (
                            <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-emerald-700 text-white dark:bg-emerald-800">
                              Attendance Confirmed
                            </span>
                          )}
                          {st === "confirmed" && attendance === "marked" && (
                            <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800">
                              Checked In (Awaiting Confirmation)
                            </span>
                          )}
                        </div>

                        {serialId && (st === "confirmed" || isCancelled || isRescheduled || refundState !== "none") && (
                          <div className="bg-stone-800 text-stone-50 dark:bg-slate-800 dark:border dark:border-slate-700 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-300 dark:text-slate-400 block">
                                Official Attendee Serial ID
                              </span>
                              <span className="font-mono text-base font-black tracking-wider">{serialId}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] text-stone-200 dark:text-slate-300 font-medium">
                                {isCancelled || refundState !== "none"
                                  ? "Present this Serial ID to the organizer for refund verification."
                                  : "Present this Serial ID at the venue for attendance verification."}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopySerial(serialId)}
                                className="px-3 py-1.5 bg-white/15 hover:bg-white/25 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
                              >
                                {copiedSerialId === serialId ? "Copied ✓" : "Copy ID"}
                              </button>
                            </div>
                          </div>
                        )}

                        {isCancelled && (
                          <div className="bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-xl p-4 text-xs text-rose-950 dark:text-rose-200 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] font-black uppercase tracking-wider text-rose-800 dark:text-rose-300">
                                Event Cancelled Notice
                              </p>
                              {refundState === "refunded" ? (
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 text-[10px] font-black uppercase">
                                  Refund Completed
                                </span>
                              ) : refundState === "requested" ? (
                                <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 text-[10px] font-black uppercase">
                                  Refund Requested — Contact Organizer
                                </span>
                              ) : null}
                            </div>
                            <p className="font-medium leading-relaxed">
                              This event has been cancelled by the organizer and approved by the Municipal Tourism Office.
                              {actionMeta.action_reason ? (
                                <>
                                  {" "}
                                  <strong>Reason:</strong> {actionMeta.action_reason}
                                </>
                              ) : null}
                            </p>
                            <div className="bg-white/90 dark:bg-slate-900/90 border border-rose-200 dark:border-rose-900/60 rounded-lg p-3 space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                Organizer Contact Details for Refunds & Inquiries
                              </p>
                              <p className="font-bold text-slate-900 dark:text-slate-100">
                                {actionMeta.organizer_contact_info || event.organizer_name || "Contact the Municipal Tourism Office"}
                              </p>
                              {serialId && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                  Reference your Serial ID <strong className="font-mono text-slate-900 dark:text-white">{serialId}</strong> when reaching out to claim your refund.
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {isRescheduled && (
                          <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/70 rounded-xl p-4 text-xs text-amber-950 dark:text-amber-200 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                                Event Rescheduled — Action Required
                              </p>
                              {reg.reschedule_choice === "continued" && refundState === "none" && (
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 text-[10px] font-black uppercase">
                                  You Confirmed Attendance
                                </span>
                              )}
                            </div>
                            <p className="font-medium leading-relaxed">
                              This event has been moved to{" "}
                              <strong>
                                {formatDate(startDateVal)}
                                {endDateVal && endDateVal !== startDateVal ? ` – ${formatDate(endDateVal)}` : ""}
                                {formatTimeRange(event) ? ` (${formatTimeRange(event)})` : ""}
                              </strong>
                              .
                              {actionMeta.action_reason ? (
                                <>
                                  {" "}
                                  <strong>Reason:</strong> {actionMeta.action_reason}
                                </>
                              ) : null}
                            </p>
                            {actionMeta.organizer_contact_info && (
                              <div className="bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-900/60 rounded-lg p-3 space-y-0.5">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                  Organizer Contact Details (Refunds & Questions)
                                </p>
                                <p className="font-bold text-slate-900 dark:text-slate-100">{actionMeta.organizer_contact_info}</p>
                              </div>
                            )}
                            {refundState === "none" && reg.reschedule_choice !== "continued" && (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleContinueRescheduledEvent(reg)}
                                  disabled={isChoiceBusy}
                                  className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 disabled:opacity-60 rounded-xl font-bold text-[11px] uppercase shadow-sm transition-all"
                                >
                                  {isChoiceBusy ? "Saving..." : "Continue with New Schedule"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRequestRefund(reg)}
                                  disabled={isChoiceBusy}
                                  className="px-4 py-2 bg-rose-50/90 hover:bg-rose-100 disabled:opacity-60 text-rose-700 border border-rose-200/80 dark:bg-rose-950/50 dark:hover:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800/70 rounded-xl font-bold text-[11px] uppercase transition-all"
                                >
                                  Request Refund
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {!isCancelled && duplicateMatches.length > 0 && (
                          <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/70 rounded-xl p-3 text-xs text-amber-950 dark:text-amber-200 space-y-0.5">
                            <p className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                              Duplicate / Overlapping Event Notice
                            </p>
                            <p className="font-medium">
                              Another scheduled event matches this title or date/venue:{" "}
                              {duplicateMatches
                                .slice(0, 2)
                                .map((m) => `"${m.event_name}" (${m.event_date || "TBA"} at ${m.venue || "TBA"})`)
                                .join(", ")}
                              .
                            </p>
                          </div>
                        )}

                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{event.description || "No event description provided."}</p>

                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1 bg-stone-50 dark:bg-slate-800 p-3 rounded-xl border border-stone-200/70 dark:border-slate-700 [&_strong]:text-slate-900 dark:[&_strong]:text-white">
                          <p><strong>Organizer:</strong> {event.organizer_name || "Municipal Tourism Office"}</p>
                          <p><strong>Venue:</strong> {event.venue || "TBA"}</p>
                          <p>
                            <strong>{isRescheduled ? "Updated Date & Time:" : "Date & Time:"}</strong> {formatDate(startDateVal)}
                            {endDateVal && endDateVal !== startDateVal ? ` – ${formatDate(endDateVal)}` : ""} | {formatTimeRange(event) || "TBA"}
                          </p>
                          {reg.team_name && (
                            <div className="pt-1 space-y-1">
                              <p><strong>Team:</strong> {reg.team_name} ({members.length} members)</p>
                              {serialId && members.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {members.map((m, idx) => (
                                    <span
                                      key={idx}
                                      className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-200"
                                    >
                                      {serialId}-{idx + 1}: {m.first_name} {m.last_name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {event.is_paid && <p><strong>Fee:</strong> {peso(event.fee_amount)}{regTypeOf(event) === "group" ? " per team" : ""}</p>}
                        </div>

                        {!isCancelled && st === "confirmed" && isOngoing && (
                          <div
                            className={`rounded-xl border p-3 text-xs space-y-1 ${
                              attendance === "confirmed"
                                ? "bg-emerald-50/80 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800/70 dark:text-emerald-200"
                                : attendance === "marked"
                                ? "bg-amber-50/80 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800/70 dark:text-amber-200"
                                : "bg-stone-100 border-stone-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                            }`}
                          >
                            <p className="text-[10px] font-black uppercase tracking-wider">
                              {attendance === "confirmed"
                                ? "Official Attendance Confirmed"
                                : attendance === "marked"
                                ? "Attendance Check-In Sent"
                                : "Event Is Happening Now — Attendance Check-In Open"}
                            </p>
                            <p className="font-medium">
                              {attendance === "confirmed"
                                ? "The organizer has verified your Serial ID and confirmed you as present."
                                : attendance === "marked"
                                ? "You marked yourself present. The organizer can now see your check-in and confirm your attendance."
                                : "Tap \"Check In / Mark Present\" on the right to notify the organizer that you are at the venue."}
                            </p>
                          </div>
                        )}

                        {event.is_paid && (
                          <div
                            className={`rounded-xl border p-3 text-xs space-y-1.5 ${
                              refundState === "refunded"
                                ? "bg-stone-100 border-stone-300 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                                : refundState === "requested"
                                ? "bg-amber-50/80 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800/70 dark:text-amber-200"
                                : isPendingReview
                                ? "bg-amber-50/80 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800/70 dark:text-amber-200"
                                : st === "rejected"
                                ? "bg-rose-50/80 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800/70 dark:text-rose-200"
                                : "bg-emerald-50/80 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800/70 dark:text-emerald-200"
                            }`}
                          >
                            <p className="text-[10px] font-black uppercase tracking-wider">
                              {refundState === "refunded"
                                ? "Refund confirmed by the organizer"
                                : refundState === "requested"
                                ? "Refund requested — awaiting organizer confirmation"
                                : isResubmitted
                                ? "Resubmitted — waiting for the organizer to confirm your payment"
                                : st === "pending"
                                ? "Waiting for the organizer to confirm your payment"
                                : st === "rejected"
                                ? "Your registration was rejected"
                                : "Payment confirmed by the organizer"}
                            </p>
                            <p className="font-semibold">
                              Payment method: {reg.payment_method || "N/A"}
                              {reg.payment_reference ? ` | Ref: ${reg.payment_reference}` : ""}
                            </p>

                            {!isCancelled && isPendingReview && (
                              <p className="font-medium whitespace-pre-line">
                                {(reg.payment_method || "").toLowerCase() === "online"
                                  ? `Send your payment to: ${event.online_payment_details || "ask the organizer for payment details."}`
                                  : `Pay your cash at: ${event.cash_payment_details || "ask the organizer where to pay."}`}
                              </p>
                            )}
                            {!isCancelled && isPendingReview && (
                              <p className="font-medium">
                                You will receive your official Serial ID once the organizer approves your payment. Until then you are not on the official attendee list.
                              </p>
                            )}
                            {st === "rejected" && (
                              <p className="font-medium">
                                <strong>Reason:</strong> {reg.rejection_reason || "No reason was provided."} Please resubmit your registration.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col justify-center items-stretch gap-2.5 min-w-[185px]">
                        {isCancelled ? (
                          <>
                            {refundState === "none" && st === "confirmed" && (
                              <button
                                type="button"
                                onClick={() => handleRequestRefund(reg)}
                                disabled={isChoiceBusy}
                                className="w-full py-2.5 bg-rose-700 hover:bg-rose-600 dark:bg-rose-800 dark:hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                              >
                                {isChoiceBusy ? "Submitting..." : "Request Refund"}
                              </button>
                            )}
                            {refundState === "requested" && (
                              <span className="w-full py-2.5 px-3 bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 text-[11px] font-black rounded-xl uppercase text-center">
                                Refund Requested
                              </span>
                            )}
                            {refundState === "refunded" && (
                              <span className="w-full py-2.5 px-3 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 text-[11px] font-black rounded-xl uppercase text-center">
                                Refund Confirmed
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setHiddenCancelledIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(String(reg.id));
                                  return next;
                                })
                              }
                              className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-slate-600 border border-stone-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 text-xs font-bold rounded-xl uppercase transition-all text-center"
                            >
                              Hide Notice
                            </button>
                          </>
                        ) : phase === "Completed" ? (
                          <span className="w-full py-2.5 bg-stone-100 text-slate-500 border border-stone-200/80 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 text-xs font-bold rounded-xl uppercase text-center shadow-sm">
                            Event completed
                          </span>
                        ) : (
                          <>
                            {isRescheduled && refundState === "none" && reg.reschedule_choice !== "continued" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleContinueRescheduledEvent(reg)}
                                  disabled={isChoiceBusy}
                                  className="w-full py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 disabled:opacity-60 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                                >
                                  {isChoiceBusy ? "Saving..." : "Continue Schedule"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRequestRefund(reg)}
                                  disabled={isChoiceBusy}
                                  className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 disabled:opacity-60 text-amber-900 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 dark:text-amber-200 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                                >
                                  Request Refund
                                </button>
                              </>
                            )}
                            {isRescheduled && refundState === "none" && reg.reschedule_choice === "continued" && (
                              <button
                                type="button"
                                onClick={() => handleRequestRefund(reg)}
                                disabled={isChoiceBusy}
                                className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 disabled:opacity-60 text-amber-900 border border-amber-200 dark:bg-amber-950/50 dark:hover:bg-amber-950/80 dark:text-amber-200 dark:border-amber-800/70 text-xs font-bold rounded-xl uppercase transition-all text-center"
                              >
                                Request Refund Instead
                              </button>
                            )}
                            {st === "confirmed" && isOngoing && attendance === "unmarked" && (
                              <button
                                type="button"
                                onClick={() => handleTouristCheckIn(reg)}
                                disabled={busyCheckInId === reg.id}
                                className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 dark:bg-emerald-800 dark:hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                              >
                                {busyCheckInId === reg.id ? "Checking In..." : "Check In / Mark Present"}
                              </button>
                            )}
                            {st === "confirmed" && isOngoing && attendance === "marked" && (
                              <button
                                type="button"
                                onClick={() => handleUndoTouristCheckIn(reg)}
                                disabled={busyCheckInId === reg.id}
                                className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 disabled:opacity-60 text-amber-900 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 dark:text-amber-200 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                              >
                                Undo Check-In
                              </button>
                            )}
                            {st === "rejected" && (
                              <button
                                onClick={() => openResubmit(reg)}
                                className="w-full py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                              >
                                Resubmit Registration
                              </button>
                            )}
                            {refundState === "none" && (
                              <button
                                onClick={() => handleCancelRegistration(reg.id)}
                                className="w-full py-2.5 bg-rose-50/80 hover:bg-rose-100 text-rose-700 border border-rose-200/80 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 dark:text-rose-300 dark:border-rose-900/60 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                              >
                                Cancel Registration
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "interested" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Interested Events</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                  Events you starred on the public schedule. You get a reminder here one day before they start.
                </p>
              </div>
              <BackButton />
            </div>

            {upcomingInterested.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 text-center space-y-3 shadow-sm">
                <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase">You haven't marked any upcoming events as interested.</p>
                <Link href="/programs">
                  <button className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-xl font-bold text-xs transition-all shadow-sm">
                    Browse events
                  </button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {upcomingInterested.map((ev) => {
                  const img = getImageUrl(ev.image_urls?.[0] || ev.image_url);
                  const startDateVal = ev.event_date || ev.date;
                  const endDateVal = ev.event_end_date || ev.end_date;
                  const duplicateMatches = duplicatesByEventId.get(String(ev.id)) || [];

                  return (
                    <div key={ev.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-stone-200/90 dark:border-slate-800 flex flex-col md:flex-row gap-5 shadow-sm">
                      {img ? (
                        <button type="button" onClick={() => setViewerSrc(img)} className={EVENT_THUMB} aria-label={`View full photo of ${ev.event_name}`}>
                          <img
                            src={img}
                            alt={ev.event_name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.src = "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=600&q=80";
                            }}
                          />
                        </button>
                      ) : (
                        <div className={`${EVENT_THUMB} flex items-center justify-center text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase`}>No Photo</div>
                      )}
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-black text-base text-slate-900 dark:text-slate-100">{ev.event_name}</h3>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${phaseBadge[getPhase(ev.status)]}`}>
                            {getPhase(ev.status) === "Ongoing" ? "Happening now" : getPhase(ev.status)}
                          </span>
                          <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">{startsLabel(ev)}</span>
                        </div>
                        {duplicateMatches.length > 0 && (
                          <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/70 rounded-xl p-2.5 text-xs text-amber-950 dark:text-amber-200">
                            <strong className="uppercase text-[10px] tracking-wider text-amber-800 dark:text-amber-300 block">
                              Duplicate / Overlapping Event Notice
                            </strong>
                            Another scheduled event matches this title or date/venue:{" "}
                            {duplicateMatches
                              .slice(0, 2)
                              .map((m) => `"${m.event_name}" (${m.event_date || "TBA"} at ${m.venue || "TBA"})`)
                              .join(", ")}
                            .
                          </div>
                        )}
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">{ev.description || "No event description provided."}</p>
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-0.5 bg-stone-50 dark:bg-slate-800 p-3 rounded-xl border border-stone-200/70 dark:border-slate-700 [&_strong]:text-slate-900 dark:[&_strong]:text-white">
                          <p><strong>Venue:</strong> {ev.venue || "TBA"}</p>
                          <p>
                            <strong>Date & Time:</strong> {formatDate(startDateVal)}
                            {endDateVal && endDateVal !== startDateVal ? ` – ${formatDate(endDateVal)}` : ""} | {formatTimeRange(ev) || "TBA"}
                          </p>
                          {ev.is_paid && <p><strong>Fee:</strong> {peso(ev.fee_amount)}</p>}
                        </div>
                      </div>
                      <div className="flex flex-col justify-center items-stretch gap-2.5 min-w-[160px]">
                        <Link href="/programs" className="w-full">
                          <button className="w-full py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center">
                            {regTypeOf(ev) === "interested" ? "View event" : "View & join"}
                          </button>
                        </Link>
                        <button
                          onClick={() => removeInterest(ev.id)}
                          className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-slate-700 border border-stone-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                        >
                          Remove
                        </button>
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
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Official Event Calendar</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                  Explore the 1-year municipal event schedule across Daet and inspect same-day activities.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <BackButton />
                <Link href="/programs">
                  <button className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-xl font-bold text-xs transition-all whitespace-nowrap shadow-sm">
                    Join Events →
                  </button>
                </Link>
              </div>
            </div>

            <EventCalendar
              events={allEvents}
              role="tourist"
              onSelectEvent={(ev) => setCalendarSelectedEvent(ev)}
            />
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Notifications & Event Alerts</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">Real-time schedule updates, cancellation notices, and status alerts for your municipal activities.</p>
              </div>
              <BackButton />
            </div>

            {reminders.filter((ev) => !dismissedNotifs.has(`reminder-${ev.id}`)).length > 0 && (
              <div className="space-y-3">
                {reminders
                  .filter((ev) => !dismissedNotifs.has(`reminder-${ev.id}`))
                  .map((ev) => (
                    <div key={`reminder-${ev.id}`} className="bg-amber-50/90 dark:bg-amber-950/40 p-5 rounded-2xl border border-amber-200 dark:border-amber-800/70 shadow-sm relative flex gap-3 items-start">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-amber-800 dark:text-amber-300 uppercase tracking-wider">Reminder - event you are interested in</span>
                          <span className="text-[10px] text-amber-800 dark:text-amber-300 font-bold uppercase">{startsLabel(ev)}</span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          <span className="underline">{ev.event_name}</span>{" "}
                          {getPhase(ev.status) === "Ongoing" ? "is happening now." : "starts within the next day."}
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          Location: {ev.venue || "TBA"} | {formatDate(ev.event_date || ev.date)}
                          {formatTime(ev.event_time) ? ` at ${formatTime(ev.event_time)}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => dismissNotification(`reminder-${ev.id}`)}
                        className="text-slate-400 hover:text-rose-500 transition-colors p-1 flex-shrink-0"
                        aria-label="Dismiss notification"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                  ))}
              </div>
            )}

            {totalActiveNotifications === 0 ? (
              <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 text-center text-slate-400 dark:text-slate-500 text-xs font-bold uppercase shadow-sm">
                No active notifications or updates available.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRegistrations
                  .filter((reg) => !dismissedNotifs.has(`reg-notif-${reg.id}`))
                  .map((reg) => {
                    const event = eventsMap[reg.event_id] || {};
                    const evStatusNorm = norm(event.status);
                    const isCancelled = evStatusNorm === "cancelled";
                    const isRescheduled = evStatusNorm === "rescheduled";
                    const phase = getPhase(event.status);
                    const st = regState(reg);
                    const isResubmitted = norm(reg.registration_status) === "resubmitted" || st === "resubmitted";
                    const serialId = resolveRegistrationSerial(reg);
                    const refundState = resolveRefundState(reg);
                    const attendance = resolveAttendanceState(reg);
                    const actionMeta = parseEventActionMeta(event);

                    return (
                      <div
                        key={reg.id}
                        className={`bg-white dark:bg-slate-900 p-5 rounded-2xl border shadow-sm relative flex gap-3 items-start ${
                          isCancelled
                            ? "border-rose-300 dark:border-rose-800/80 bg-rose-50/30 dark:bg-rose-950/20"
                            : isRescheduled
                            ? "border-amber-300 dark:border-amber-800/80 bg-amber-50/30 dark:bg-amber-950/20"
                            : "border-stone-200/90 dark:border-slate-800"
                        }`}
                      >
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-[10px] font-black uppercase tracking-wider ${
                                  isCancelled
                                    ? "text-rose-700 dark:text-rose-300"
                                    : isRescheduled
                                    ? "text-amber-800 dark:text-amber-300"
                                    : isResubmitted
                                    ? "text-violet-700 dark:text-violet-300"
                                    : "text-slate-700 dark:text-slate-200"
                                }`}
                              >
                                {isCancelled
                                  ? "Event Cancelled"
                                  : isRescheduled
                                  ? "Event Rescheduled"
                                  : isResubmitted
                                  ? "Registration Resubmitted"
                                  : st === "pending"
                                  ? "Awaiting Approval"
                                  : st === "rejected"
                                  ? "Registration Rejected"
                                  : phase === "Upcoming"
                                  ? "Registration Notice"
                                  : "Event Update"}
                              </span>
                              {serialId && (st === "confirmed" || isCancelled || isRescheduled) && (
                                <span className="px-2 py-0.5 rounded-md bg-stone-800 text-stone-50 dark:bg-slate-800 dark:text-slate-200 dark:border dark:border-slate-700 font-mono text-[10px] font-bold">
                                  Serial: {serialId}
                                </span>
                              )}
                              {refundState === "requested" && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 text-[9px] font-black uppercase">
                                  Refund Requested
                                </span>
                              )}
                              {refundState === "refunded" && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 text-[9px] font-black uppercase">
                                  Refunded
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-400 font-semibold">{new Date(reg.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            <span className="underline">{event.event_name || "Municipal Program"}</span>{" "}
                            {isCancelled
                              ? "has been cancelled. Use your Serial ID and the organizer contact details below to claim a refund."
                              : isRescheduled
                              ? `has been rescheduled to ${formatDate(event.event_date || event.date)}${formatTimeRange(event) ? ` (${formatTimeRange(event)})` : ""}. Open My Events to continue attending or request a refund.`
                              : isResubmitted
                              ? "resubmission was received. The organizer is checking your updated payment details."
                              : st === "pending"
                              ? "registration is pending. The organizer is checking your payment."
                              : st === "rejected"
                              ? "registration was rejected. Please resubmit it from My Events."
                              : phase === "Ongoing"
                              ? attendance === "confirmed"
                                ? "is happening now and your attendance has been confirmed!"
                                : "is happening now. Go to My Events to check in and show your Serial ID."
                              : phase === "Completed"
                              ? "has been completed. Thank you for taking part."
                              : "registration is confirmed. You are on the official attendee list."}
                          </p>
                          {(isCancelled || isRescheduled) && actionMeta.action_reason && (
                            <p className="text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl p-3">
                              <strong>Reason:</strong> {actionMeta.action_reason}
                            </p>
                          )}
                          {(isCancelled || isRescheduled) && actionMeta.organizer_contact_info && (
                            <p className="text-xs text-slate-800 dark:text-slate-200 bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl p-3">
                              <strong>Organizer Refund & Inquiry Contact:</strong> {actionMeta.organizer_contact_info}
                            </p>
                          )}
                          {st === "rejected" && reg.rejection_reason && (
                            <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-xl p-3 mt-1">
                              <strong>Organizer note:</strong> {reg.rejection_reason}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Location: {event.venue || "TBA"} | {isRescheduled ? "New Date:" : "Scheduled Date:"} {formatDate(event.event_date || event.date)}
                            </p>
                            {(isCancelled || isRescheduled) && (
                              <button
                                type="button"
                                onClick={() => setActiveTab("my-events")}
                                className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-lg text-[10px] font-bold uppercase transition-all"
                              >
                                Manage in My Events →
                              </button>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => dismissNotification(`reg-notif-${reg.id}`)}
                          className="text-slate-400 hover:text-rose-500 transition-colors p-1 flex-shrink-0"
                          aria-label="Dismiss notification"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {activeTab === "account" && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] py-10">
            <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl border border-stone-200/90 dark:border-slate-800 shadow-xl overflow-hidden space-y-6">
              <div className="flex items-center gap-4 p-6 border-b border-stone-200/80 dark:border-slate-800 bg-stone-800 dark:bg-slate-800 text-stone-50">
                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-xl font-black flex-shrink-0">
                  {(profile?.full_name || user?.email || "T").trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-black truncate">{profile?.full_name || "Tourist Account"}</p>
                  <p className="text-xs text-stone-300 dark:text-slate-300 truncate">{user?.email}</p>
                </div>
              </div>

              <div className="px-6 pb-6">
                <dl className="divide-y divide-stone-100 dark:divide-slate-800 text-xs">
                  {accountRows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-3 gap-4 py-3.5">
                      <dt className="font-bold text-slate-500 dark:text-slate-400">{label}</dt>
                      <dd className="col-span-2 font-semibold text-slate-800 dark:text-slate-200 break-words">
                        {value !== undefined && value !== null && value !== "" ? String(value) : <span className="text-slate-300 dark:text-slate-600">Not provided</span>}
                      </dd>
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-4 py-3.5">
                    <dt className="font-bold text-slate-500 dark:text-slate-400">Active registrations</dt>
                    <dd className="col-span-2 font-semibold text-slate-800 dark:text-slate-200">{visibleRegistrations.length}</dd>
                  </div>
                </dl>
              </div>

              <div className="px-6 pb-6 flex justify-center">
                <BackButton />
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] py-10">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 p-8 rounded-2xl border border-stone-200/90 dark:border-slate-800 shadow-xl space-y-6 text-xs font-semibold">
              <div className="text-center border-b border-stone-100 dark:border-slate-800 pb-4 relative">
                <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Account Settings</h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-1 uppercase tracking-widest">Update password and security</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-bold uppercase tracking-wider text-center">ACCOUNT EMAIL</label>
                  <input type="email" disabled value={newEmail} className="w-full p-3.5 bg-stone-100 dark:bg-slate-800/80 border border-stone-200 dark:border-slate-700 rounded-xl font-bold text-slate-600 dark:text-slate-400 text-center cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-bold uppercase tracking-wider text-center">NEW PASSWORD</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full p-3.5 bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-stone-400/30 text-center transition-all"
                  />
                </div>
                <button
                  onClick={async () => {
                    if (!newPassword) return notify("Please enter a new password first.");
                    const { error } = await supabase.auth.updateUser({ password: newPassword });
                    if (error) {
                      notify("Error updating password: " + error.message);
                    } else {
                      setNewPassword("");
                      setPwSaved(true);
                      setTimeout(() => setPwSaved(false), 2000);
                    }
                  }}
                  className="w-full py-3.5 mt-2 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-xl font-black uppercase tracking-wider shadow-md hover:shadow-lg transition-all"
                >
                  {pwSaved ? "Saved ✓" : "Save Account Settings"}
                </button>
              </div>
              <div className="pt-2 flex justify-center">
                <BackButton />
              </div>
            </div>
          </div>
        )}
      </DashboardShell>

      {calendarSelectedEvent && (() => {
        const img = getImageUrl(calendarSelectedEvent.image_urls?.[0] || calendarSelectedEvent.image_url);
        const startDateVal = calendarSelectedEvent.event_date || calendarSelectedEvent.date;
        const endDateVal = calendarSelectedEvent.event_end_date || calendarSelectedEvent.end_date;
        const matchedReg = registrations.find((r) => String(r.event_id) === String(calendarSelectedEvent.id));
        const alreadyRegistered = Boolean(matchedReg);
        const matchedSerial = matchedReg ? resolveRegistrationSerial(matchedReg) : "";
        const alreadyInterested = interestedEvents.some((ev) => String(ev.id) === String(calendarSelectedEvent.id));
        const duplicateMatches = duplicatesByEventId.get(String(calendarSelectedEvent.id)) || [];

        return (
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={() => setCalendarSelectedEvent(null)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto border border-stone-100 dark:border-slate-800 text-xs font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              {img && (
                <button
                  type="button"
                  onClick={() => setViewerSrc(img)}
                  className="relative w-full aspect-[16/9] bg-stone-100 dark:bg-slate-800 block group overflow-hidden"
                >
                  <img
                    src={img}
                    alt={calendarSelectedEvent.event_name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=600&q=80";
                    }}
                  />
                  <span className="absolute bottom-2.5 right-2.5 px-2.5 py-1 bg-black/65 text-white text-[10px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    View full photo
                  </span>
                </button>
              )}

              <div className="p-6 sm:p-8 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${phaseBadge[getPhase(calendarSelectedEvent.status)]}`}>
                    {getPhase(calendarSelectedEvent.status) === "Ongoing" ? "Happening now" : getPhase(calendarSelectedEvent.status)}
                  </span>
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-full uppercase bg-stone-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {REG_TYPE_LABEL[regTypeOf(calendarSelectedEvent)]}
                  </span>
                  {alreadyRegistered && (
                    <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                      Registered
                    </span>
                  )}
                  {matchedSerial && (
                    <span className="px-2.5 py-1 text-[10px] font-mono font-bold rounded-full bg-stone-800 text-stone-50 dark:bg-slate-800 dark:text-slate-100 dark:border dark:border-slate-700">
                      {matchedSerial}
                    </span>
                  )}
                  {!alreadyRegistered && alreadyInterested && (
                    <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                      ★ Interested
                    </span>
                  )}
                </div>

                <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 leading-snug">{calendarSelectedEvent.event_name}</h3>

                {duplicateMatches.length > 0 && (
                  <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/70 rounded-xl p-3 text-xs text-amber-950 dark:text-amber-200 space-y-0.5">
                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      Duplicate / Overlapping Event Notice
                    </p>
                    <p className="font-medium">
                      Matches{" "}
                      {duplicateMatches
                        .slice(0, 2)
                        .map((m) => `"${m.event_name}" (${m.event_date || "TBA"} at ${m.venue || "TBA"})`)
                        .join(", ")}
                      .
                    </p>
                  </div>
                )}

                <p className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                  {calendarSelectedEvent.description || "No event description provided."}
                </p>

                <div className="bg-stone-50 dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 rounded-xl p-4 space-y-1.5 text-slate-600 dark:text-slate-300 [&_strong]:text-slate-900 dark:[&_strong]:text-white">
                  <p><strong>Organizer:</strong> {calendarSelectedEvent.organizer_name || "Municipal Tourism Office"}</p>
                  <p><strong>Venue:</strong> {calendarSelectedEvent.venue || "TBA"}</p>
                  <p>
                    <strong>Date:</strong> {formatDate(startDateVal)}
                    {endDateVal && endDateVal !== startDateVal ? ` – ${formatDate(endDateVal)}` : ""}
                  </p>
                  <p><strong>Time:</strong> {formatTimeRange(calendarSelectedEvent) || "TBA"}</p>
                  <p>
                    <strong>Fee:</strong>{" "}
                    {calendarSelectedEvent.is_paid
                      ? `${peso(calendarSelectedEvent.fee_amount)}${regTypeOf(calendarSelectedEvent) === "group" ? " per team" : ""}`
                      : "Free"}
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <Link href="/programs" className="flex-1">
                    <button
                      type="button"
                      className="w-full py-3 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                    >
                      {alreadyRegistered ? "Open Public Schedule" : "Go to Programs to Join →"}
                    </button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setCalendarSelectedEvent(null)}
                    className="px-5 py-3 bg-stone-100 hover:bg-stone-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-xl font-bold transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {resubmitReg && (() => {
        const event = eventsMap[resubmitReg.event_id] || {};
        const paymentMeta = parseOrganizerPaymentDetails(event);
        const methodOptions = [
          { value: "cash", label: "Cash" },
          ...(paymentMeta.hasBank ? [{ value: "bank", label: "Bank Payment" }] : []),
          ...(paymentMeta.hasOnline || !paymentMeta.hasBank
            ? [{ value: "online", label: "Online Payment" }]
            : []),
        ];

        return (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-900 rounded-[35px] max-w-md w-full p-8 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto border border-stone-100 dark:border-slate-800 text-xs font-semibold">
              <div>
                <span className="text-[10px] font-black text-slate-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 px-3 py-1 rounded-full uppercase tracking-wider">
                  Resubmit Registration
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 mt-2">{event.event_name || "Event"}</h2>
                {resubmitReg.rejection_reason && (
                  <p className="mt-2 text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-xl p-3 font-medium">
                    <strong>Organizer note:</strong> {resubmitReg.rejection_reason}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400 uppercase">Registration fee</span>
                <span className="text-lg font-black text-slate-900 dark:text-slate-100">{peso(event.fee_amount)}</span>
              </div>

              <div className={`grid ${methodOptions.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"} gap-2`}>
                {methodOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResubForm({ ...resubForm, method: opt.value })}
                    className={`py-3 px-2 rounded-xl border-2 font-bold transition-all text-center ${
                      resubForm.method === opt.value
                        ? "border-stone-800 bg-stone-50 text-slate-900 shadow-sm dark:border-slate-200 dark:bg-slate-800 dark:text-slate-100"
                        : "border-stone-200 bg-white text-slate-500 hover:border-stone-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-500"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {resubForm.method === "cash" && (
                <div className="bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">Pay your cash here</p>
                  <p className="text-slate-800 dark:text-slate-200 whitespace-pre-line">
                    {event.cash_payment_details || "The organizer has not stated a cash payment location yet."}
                  </p>
                </div>
              )}

              {resubForm.method === "bank" && (
                <div className="space-y-4">
                  <div className="bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl p-3.5 space-y-2.5">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                      Bank Transfer Account Details
                    </p>
                    <div className="space-y-1.5">
                      <div>
                        <span className="block text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">
                          Bank Name
                        </span>
                        <span className="font-black text-slate-900 dark:text-slate-100">
                          {paymentMeta.bankName || "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">
                          Account Name
                        </span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {paymentMeta.bankAccountName || "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">
                          Account Number
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono font-black text-slate-900 dark:text-slate-100">
                            {paymentMeta.bankAccountNumber || "N/A"}
                          </span>
                          {paymentMeta.bankAccountNumber && (
                            <button
                              type="button"
                              onClick={() => handleCopySerial(paymentMeta.bankAccountNumber, "Account Number")}
                              className="px-2 py-0.5 rounded-md bg-stone-200 hover:bg-stone-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 text-[10px] font-bold transition-all"
                            >
                              {copiedSerialId === paymentMeta.bankAccountNumber ? "Copied ✓" : "Copy"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1">PAYMENT REFERENCE NO.</label>
                    <input
                      type="text"
                      placeholder="Reference number from your bank transfer receipt"
                      value={resubForm.reference}
                      onChange={(e) => setResubForm({ ...resubForm, reference: e.target.value })}
                      className="w-full p-3 bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-stone-400/30"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1">RECEIPT SCREENSHOT (OPTIONAL)</label>
                    <FilePicker files={resubProof} onChange={setResubProof} multiple={false} accept="image/*" label="Attach receipt photo" />
                  </div>
                </div>
              )}

              {resubForm.method === "online" && (
                <div className="space-y-4">
                  <div className="bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">Online Payment Details</p>
                    <p className="text-slate-800 dark:text-slate-200 whitespace-pre-line">
                      {paymentMeta.onlineDetails || "The organizer has not provided online e-wallet payment details yet."}
                    </p>
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1">PAYMENT REFERENCE NO.</label>
                    <input
                      type="text"
                      placeholder="Reference number from your receipt"
                      value={resubForm.reference}
                      onChange={(e) => setResubForm({ ...resubForm, reference: e.target.value })}
                      className="w-full p-3 bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-stone-400/30"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1">RECEIPT SCREENSHOT (OPTIONAL)</label>
                    <FilePicker files={resubProof} onChange={setResubProof} multiple={false} accept="image/*" label="Attach receipt photo" />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleResubmit}
                  disabled={resubSaving}
                  className="w-full py-3.5 bg-stone-800 hover:bg-stone-700 text-stone-50 dark:bg-slate-200 dark:hover:bg-white dark:text-slate-900 disabled:opacity-60 rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm text-center"
                >
                  {resubSaving ? "Submitting..." : "Resubmit"}
                </button>
                <button
                  onClick={() => setResubmitReg(null)}
                  disabled={resubSaving}
                  className="px-5 py-3.5 bg-stone-100 hover:bg-stone-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-xl font-bold transition-all text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Event photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}
    </div>
  );
}