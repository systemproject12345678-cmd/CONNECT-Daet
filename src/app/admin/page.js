"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";
import DashboardShell from "@/components/ui/DashboardShell";
import EventCalendar from "@/components/ui/EventCalendar";
import { AttachmentList, FilePicker } from "@/components/ui/Attachments";
import { ImageCarousel } from "@/components/ui/ImageCarousel";
import { uploadAttachments, validateFiles, peso, regState, getImageList } from "@/lib/eventHelpers";
import { withLiveStatus, useNow, formatTime, formatTimeRange, regTypeOf, REG_TYPE_LABEL, teamMembersOf } from "@/lib/eventSchedule";
import TeamDetails from "@/components/ui/TeamDetails";

const OFFICIAL_ADMIN_EMAIL = "admin.daet@gmail.com";

const EVENT_THUMB =
  "relative w-full md:w-56 h-44 md:h-40 flex-shrink-0 self-start rounded-xl overflow-hidden bg-slate-100 group";

const EVENT_FILTERS = [
  "All",
  "Pending",
  "Upcoming",
  "Ongoing",
  "Completed",
  "Requires Changes",
  "Requirements Needed",
  "Requirements Submitted",
  "Rejected",
  "Cancelled",
];

const getFallbackImage = (width = 300) =>
  `https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=${width}&q=80`;

const handleImageFallback = (e, width = 300) => {
  e.currentTarget.onerror = null;
  e.currentTarget.src = getFallbackImage(width);
};

const getImageUrl = (urlField) => {
  if (!urlField || typeof urlField === "function") return "";
  if (typeof urlField === "string") {
    if (urlField.startsWith("[")) {
      try {
        const parsed = JSON.parse(urlField);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") return parsed[0];
      } catch (e) {}
    }
    return urlField;
  }
  if (Array.isArray(urlField) && urlField.length > 0) {
    return typeof urlField[0] === "string" ? urlField[0] : "";
  }
  if (typeof urlField === "object") {
    return typeof urlField.url === "string" ? urlField.url : "";
  }
  return "";
};

const toSafeDisplayValue = (val) => {
  if (val === undefined || val === null || val === "" || typeof val === "function") return "";
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch (e) {
      return "";
    }
  }
  return String(val);
};

const norm = (v) => (typeof v === "string" || typeof v === "number" ? String(v).trim().toLowerCase() : "");

const isImageSrc = (v) => typeof v === "string" && (v.startsWith("data:image") || v.startsWith("http"));

const toEventDateKey = (raw) => {
  if (!raw || typeof raw === "function" || typeof raw === "object") return "";
  const match = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const formatDate = (v) => {
  if (!v || typeof v === "function") return "N/A";
  const raw = typeof v === "object" ? "" : String(v);
  if (!raw) return "N/A";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
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

const resolveAttendanceState = (r) => {
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

const expandRegistration = (r) => {
  const members = teamMembersOf(r);
  const serialId = resolveRegistrationSerial(r);
  const attendance = resolveAttendanceState(r);

  if (members.length > 0) {
    return members.map((m, i) => ({
      key: `${r.id}-${i}`,
      event_id: r.event_id,
      name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || "Unnamed member",
      email: m.email || (i === 0 ? r.email : "") || "",
      phone: m.phone_number || (i === 0 ? r.phone_number : "") || "",
      gender: m.gender,
      age: m.age,
      address: m.home_address,
      created_at: r.created_at,
      team_name: r.team_name || "Unnamed team",
      isLeader: i === 0,
      status: regState(r),
      serial_id: serialId ? `${serialId}-${i + 1}` : "",
      attendance,
    }));
  }
  return [
    {
      key: String(r.id),
      event_id: r.event_id,
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Unnamed",
      email: r.email || "",
      phone: r.phone_number || "",
      gender: r.gender,
      age: r.age,
      address: r.home_address,
      created_at: r.created_at,
      team_name: r.team_name || null,
      isLeader: false,
      status: regState(r),
      serial_id: serialId,
      attendance,
    },
  ];
};

const accountMatches = (acct, q) => {
  if (!q) return true;
  return [
    acct.full_name,
    acct.organization,
    acct.organizer_full_name,
    acct.email,
    acct.contact_number,
    acct.phone,
    acct.address,
    acct.home_address,
    acct.status,
  ]
    .filter((f) => f && typeof f !== "function")
    .some((f) => String(f).toLowerCase().includes(q));
};

const eventBelongsToOrganizer = (event, org) => {
  if (!org) return false;
  if (event.organizer_id && event.organizer_id === org.id) return true;
  const evName = norm(event.organizer_name || event.organizer);
  const orgName = norm(org.organization);
  const fullName = norm(org.organizer_full_name || org.full_name);
  if (orgName && evName.includes(orgName)) return true;
  if (fullName && evName.includes(fullName)) return true;
  return false;
};

const matchesEventFilter = (event, filter) => {
  const st = norm(event.status);
  switch (filter) {
    case "All":
      return true;
    case "Pending":
      return st === "pending" || st === "under review" || st === "";
    case "Upcoming":
      return st === "approved" || st === "upcoming";
    default:
      return st === norm(filter);
  }
};

const statusBadgeClass = (status) => {
  switch (norm(status)) {
    case "approved":
    case "upcoming":
    case "ongoing":
      return "bg-blue-100 text-blue-900";
    case "completed":
      return "bg-gray-200 text-gray-700";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "requires changes":
      return "bg-indigo-100 text-indigo-800";
    case "requirements needed":
      return "bg-teal-100 text-teal-800";
    case "requirements submitted":
      return "bg-cyan-100 text-cyan-800";
    case "cancelled":
      return "bg-slate-200 text-slate-700";
    case "cancellation requested":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
};

const regStateBadgeClass = (st) =>
  st === "confirmed"
    ? "bg-emerald-100 text-emerald-800"
    : st === "pending"
    ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-700";

const attendanceBadgeMeta = (attendance) => {
  if (attendance === "confirmed") {
    return { label: "Present (Confirmed)", cls: "bg-emerald-100 text-emerald-800" };
  }
  if (attendance === "marked") {
    return { label: "Checked In (Awaiting Organizer)", cls: "bg-amber-100 text-amber-800" };
  }
  return { label: "Not Checked In", cls: "bg-slate-100 text-slate-600" };
};

function EventMedia({ images, onPreview, className = EVENT_THUMB, emptyTextClass = "text-[10px]" }) {
  if (images.length > 0) {
    return <ImageCarousel images={images} onPreview={onPreview} className={className} />;
  }
  return (
    <div className={`${className} flex items-center justify-center text-gray-400 ${emptyTextClass} font-bold uppercase`}>
      No Photo
    </div>
  );
}

function ModalBackdrop({ maxWidth = "max-w-3xl", padding = "p-8", children }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
    >
      <div className={`bg-white rounded-2xl ${maxWidth} w-full ${padding} shadow-2xl space-y-6 text-xs font-semibold max-h-[92vh] overflow-y-auto`}>
        {children}
      </div>
    </div>
  );
}

export default function UnifiedAdminDashboard() {
  const router = useRouter();
  const { notify, confirm: askConfirm, feedbackUI } = useFeedback();
  const [pwSaved, setPwSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [activeTab, setActiveTab] = useState("overview");
  const [userManagementSubTab, setUserManagementSubTab] = useState("tourists");

  const [organizers, setOrganizers] = useState([]);
  const [tourists, setTourists] = useState([]);
  const [rawEvents, setEvents] = useState([]);
  const now = useNow(30000);
  const events = useMemo(() => rawEvents.map((e) => withLiveStatus(e, now)), [rawEvents, now]);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);

  const [dismissedNotifs, setDismissedNotifs] = useState(() => new Set());
  const [busyActionId, setBusyActionId] = useState(null);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const [feedbackModal, setFeedbackModal] = useState({
    isOpen: false,
    type: "",
    targetId: null,
    reason: "",
  });

  const [approvalModal, setApprovalModal] = useState({ isOpen: false, eventId: null, message: "", files: [] });
  const [sendingApproval, setSendingApproval] = useState(false);

  const [inspectingOrganizer, setInspectingOrganizer] = useState(null);
  const [viewingProfileOrganizer, setViewingProfileOrganizer] = useState(null);

  const [adminSelectedEvent, setAdminSelectedEvent] = useState("All");
  const [adminGenderFilter, setAdminGenderFilter] = useState("All");
  const [adminAgeFilter, setAdminAgeFilter] = useState("All");
  const [adminTeamFilter, setAdminTeamFilter] = useState("All");
  const [userSearch, setUserSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [reviewingEventId, setReviewingEventId] = useState(null);
  const [reviewTab, setReviewTab] = useState("details");
  const [interestedList, setInterestedList] = useState({ loading: false, rows: [], error: "" });

  const [viewingAccount, setViewingAccount] = useState(null);
  const [viewerSrc, setViewerSrc] = useState(null);
  const [eventStatusFilter, setEventStatusFilter] = useState("All");

  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setNewPassword] = useState("");

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        router.push("/login");
        return;
      }

      const { data: userProfile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      const userEmail = (session.user.email || "").toLowerCase();
      if (profileError || (userProfile?.role !== "admin" && userEmail !== OFFICIAL_ADMIN_EMAIL.toLowerCase())) {
        alert("Access Denied: This portal is restricted to official system administrators only.");
        router.push("/organizer/dashboard");
        return;
      }

      setAdminEmail(session.user.email || "");

      const [
        { data: profilesData, error: profilesErr },
        { data: eventsData, error: eventsErr },
        { data: regData, error: regErr },
      ] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("tourism_programs").select("*").order("created_at", { ascending: false }),
        supabase.from("event_registrations").select("*").order("created_at", { ascending: false }),
      ]);

      if (profilesErr) console.warn("Profiles fetch warning:", profilesErr.message);
      if (eventsErr) throw eventsErr;
      if (regErr) console.warn("Registrations fetch warning:", regErr.message);

      const allProfiles = profilesData || [];
      setOrganizers(allProfiles.filter((p) => p.role === "organizer"));
      setTourists(allProfiles.filter((p) => p.role === "tourist" || !p.role));
      setEvents(eventsData || []);
      setRegistrations(regData || []);
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel("admin-dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tourism_programs" }, () => fetchData(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, () => fetchData(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => fetchData(true))
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (viewerSrc) {
        setViewerSrc(null);
      } else if (feedbackModal.isOpen && !submittingFeedback) {
        setFeedbackModal({ isOpen: false, type: "", targetId: null, reason: "" });
      } else if (approvalModal.isOpen && !sendingApproval) {
        setApprovalModal({ isOpen: false, eventId: null, message: "", files: [] });
      } else if (inspectingOrganizer) {
        setInspectingOrganizer(null);
      } else if (reviewingEventId) {
        setReviewingEventId(null);
      } else if (viewingProfileOrganizer) {
        setViewingProfileOrganizer(null);
      } else if (viewingAccount) {
        setViewingAccount(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    viewerSrc,
    feedbackModal.isOpen,
    submittingFeedback,
    approvalModal.isOpen,
    sendingApproval,
    inspectingOrganizer,
    reviewingEventId,
    viewingProfileOrganizer,
    viewingAccount,
  ]);

  useEffect(() => {
    if (!reviewingEventId) {
      setInterestedList({ loading: false, rows: [], error: "" });
      return;
    }
    let cancelled = false;
    setInterestedList({ loading: true, rows: [], error: "" });
    supabase.rpc("event_interested_list", { p_event_id: String(reviewingEventId) }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.warn("Interested list warning:", error.message);
        setInterestedList({ loading: false, rows: [], error: error.message });
      } else {
        setInterestedList({ loading: false, rows: data || [], error: "" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reviewingEventId]);

  const openOrganizerDeepDive = (org) => {
    setAdminSelectedEvent("All");
    setAdminGenderFilter("All");
    setAdminAgeFilter("All");
    setAdminTeamFilter("All");
    setViewingProfileOrganizer(org);
  };

  const handleApproveOrganizer = async (id) => {
    const ok = await askConfirm({
      title: "Approve this organizer?",
      message: "The account will be verified and allowed to post events and manage attendees.",
      confirmLabel: "Approve organizer",
    });
    if (!ok) return;

    setBusyActionId(id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status: "Approved", rejection_reason: null })
        .eq("id", id);

      if (error) throw error;
      setInspectingOrganizer(null);
      await fetchData(true);
    } catch (err) {
      console.error("Approve organizer error:", err);
      notify("Error approving organizer: " + err.message);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRejectOrganizer = async () => {
    if (!feedbackModal.reason.trim()) return notify("Please provide an official rejection reason.");

    setSubmittingFeedback(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status: "Rejected", rejection_reason: feedbackModal.reason.trim() })
        .eq("id", feedbackModal.targetId);

      if (error) throw error;
      setFeedbackModal({ isOpen: false, type: "", targetId: null, reason: "" });
      setInspectingOrganizer(null);
      await fetchData(true);
    } catch (err) {
      console.error("Reject organizer error:", err);
      notify("Error rejecting organizer: " + err.message);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleToggleUserSuspension = async (userId, currentSuspendedState) => {
    const ok = await askConfirm({
      title: currentSuspendedState ? "Reactivate this account?" : "Suspend this account?",
      message: currentSuspendedState
        ? "The user will be able to log in and use the system again."
        : "The user will be blocked from using their account until you reactivate it.",
      confirmLabel: currentSuspendedState ? "Reactivate" : "Suspend account",
      tone: currentSuspendedState ? "primary" : "danger",
    });
    if (!ok) return;

    setBusyActionId(userId);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_suspended: !currentSuspendedState })
        .eq("id", userId);

      if (error) throw error;
      await fetchData(true);
    } catch (err) {
      console.error("User suspension error:", err);
      notify("Error updating user account status: " + err.message);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteAccount = async (account, kind) => {
    const label =
      kind === "organizer"
        ? account.organization || account.organizer_full_name || account.full_name || account.email || "this organizer"
        : account.full_name || account.email || "this tourist";
    const ownedEvents = kind === "organizer" ? events.filter((e) => e.organizer_id === account.id) : [];
    const ownedIds = ownedEvents.map((e) => String(e.id));
    const regCount =
      kind === "organizer"
        ? registrations.filter((r) => ownedIds.includes(String(r.event_id))).length
        : registrations.filter((r) => r.user_id === account.id).length;

    const ok = await askConfirm({
      title: `Delete ${label}?`,
      message:
        kind === "organizer"
          ? `This permanently deletes the organizer account, its ${ownedEvents.length} event proposal${ownedEvents.length === 1 ? "" : "s"} and the ${regCount} registration${regCount === 1 ? "" : "s"} for those events. This cannot be undone. Consider suspending the account instead if you may need it again.`
          : `This permanently deletes the tourist account and its ${regCount} event registration${regCount === 1 ? "" : "s"}. This cannot be undone. Consider suspending the account instead if you may need it again.`,
      confirmLabel: "Delete account",
      tone: "danger",
    });
    if (!ok) return;

    setDeletingId(account.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ userId: account.id }),
      });

      if (res.status === 404) {
        if (kind === "organizer") {
          if (ownedIds.length > 0) {
            await supabase.from("event_registrations").delete().in("event_id", ownedIds);
            await supabase.from("tourism_programs").delete().eq("organizer_id", account.id);
          }
        } else {
          await supabase.from("event_registrations").delete().eq("user_id", account.id);
        }

        const { error: profileDeleteError } = await supabase
          .from("profiles")
          .delete()
          .eq("id", account.id);

        if (profileDeleteError) throw profileDeleteError;
      } else {
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
      }

      setViewingAccount(null);
      setViewingProfileOrganizer(null);
      await fetchData(true);
      notify(`${label} was deleted.`, "info");
    } catch (err) {
      console.error("Delete account error:", err);
      notify("Could not delete the account: " + (err.message || "Unknown error"));
    } finally {
      setDeletingId(null);
    }
  };

  const updateEventStatus = async (id, newStatus) => {
    if (newStatus === "Approved") {
      const target = events.find((e) => e.id === id);
      const duplicates = findDuplicateEvents(target, events);
      if (duplicates.length > 0) {
        const sample = duplicates[0];
        const ok = await askConfirm({
          title: "Possible duplicate event detected",
          message: `An existing event "${sample.event_name}" (${sample.status || "Scheduled"} on ${sample.event_date || "TBA"} at ${sample.venue || "TBA"}) already matches this proposal. Are you sure you still want to approve it?`,
          confirmLabel: "Approve anyway",
          tone: "danger",
        });
        if (!ok) return;
      }
    }

    setBusyActionId(id);
    try {
      const updatePayload = { status: newStatus };
      if (newStatus === "Approved") {
        updatePayload.rejection_reason = null;
      }

      const { error } = await supabase
        .from("tourism_programs")
        .update(updatePayload)
        .eq("id", id);

      if (error) throw error;
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...updatePayload } : e)));
      await fetchData(true);
    } catch (err) {
      console.error("Update event error:", err);
      notify("Error updating event status: " + err.message);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSubmitEventFeedback = async () => {
    if (!feedbackModal.reason.trim()) return notify("Please enter detailed feedback.");

    let payload = {};
    if (feedbackModal.type === "reject-event") {
      payload = { status: "Rejected", rejection_reason: feedbackModal.reason.trim() };
    } else if (feedbackModal.type === "revision-event") {
      payload = { status: "Requires Changes", revision_notes: feedbackModal.reason.trim() };
    } else if (feedbackModal.type === "reject-cancellation") {
      payload = { status: "Approved", rejection_reason: `Cancellation Denied by Admin: ${feedbackModal.reason.trim()}` };
    }

    setSubmittingFeedback(true);
    try {
      const { error } = await supabase
        .from("tourism_programs")
        .update(payload)
        .eq("id", feedbackModal.targetId);

      if (error) throw error;
      setFeedbackModal({ isOpen: false, type: "", targetId: null, reason: "" });
      await fetchData(true);
    } catch (err) {
      console.error("Event feedback error:", err);
      notify("Error updating event proposal: " + err.message);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const openApprovalModal = (event) => {
    setApprovalModal({
      isOpen: true,
      eventId: event.id,
      message: event.approval_instructions || "",
      files: [],
    });
  };

  const closeApprovalModal = () => setApprovalModal({ isOpen: false, eventId: null, message: "", files: [] });

  const handleSendApprovalLetter = async () => {
    const message = approvalModal.message.trim();
    if (!message) return notify("Please write what the organizer needs to do.");
    const fileError = validateFiles(approvalModal.files);
    if (fileError) return notify(fileError);

    const target = events.find((e) => e.id === approvalModal.eventId);
    setSendingApproval(true);
    try {
      let newFiles = [];
      if (approvalModal.files.length > 0) {
        newFiles = await uploadAttachments(approvalModal.files, `approval-letters/${approvalModal.eventId}`);
      }
      const existing = Array.isArray(target?.approval_files) ? target.approval_files : [];

      const payload = {
        status: "Requirements Needed",
        approval_instructions: message,
        approval_files: [...existing, ...newFiles],
        approval_sent_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("tourism_programs").update(payload).eq("id", approvalModal.eventId);
      if (error) throw error;

      setEvents((prev) => prev.map((e) => (e.id === approvalModal.eventId ? { ...e, ...payload } : e)));
      closeApprovalModal();
      await fetchData(true);
    } catch (err) {
      console.error("Send approval letter error:", err);
      notify("Error sending approval letter: " + (err.message || "Unknown error"));
    } finally {
      setSendingApproval(false);
    }
  };

  const deleteEvent = async (id) => {
    const target = events.find((e) => e.id === id);
    const ok = await askConfirm({
      title: "Delete this event?",
      message: `"${target?.event_name || "This event"}" will be permanently removed from every dashboard and the public schedule. This cannot be undone.`,
      confirmLabel: "Delete event",
      tone: "danger",
    });
    if (!ok) return;

    setBusyActionId(id);
    try {
      const { error } = await supabase
        .from("tourism_programs")
        .delete()
        .eq("id", id);

      if (error) throw error;
      await fetchData(true);
    } catch (err) {
      console.error("Delete event error:", err);
      notify("Error deleting event: " + err.message);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleApproveCancellation = async (event) => {
    const ok = await askConfirm({
      title: "Approve this cancellation?",
      message: `"${event.event_name}" will be cancelled and removed from the public schedule and from tourists' dashboards.`,
      confirmLabel: "Approve cancellation",
      tone: "danger",
    });
    if (ok) await updateEventStatus(event.id, "Cancelled");
  };

  const dismissNotification = (id) => {
    setDismissedNotifs((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const registrationsByEvent = useMemo(() => {
    const map = new Map();
    registrations.forEach((r) => {
      const key = String(r.event_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return map;
  }, [registrations]);

  const duplicatesByEventId = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const matches = findDuplicateEvents(ev, events);
      if (matches.length > 0) map.set(String(ev.id), matches);
    });
    return map;
  }, [events]);

  const notifications = useMemo(() => {
    const notifs = [];
    organizers.forEach((o) => {
      if ((o.status === "Pending" || !o.status) && !dismissedNotifs.has(`org-${o.id}`)) {
        notifs.push({ id: `org-${o.id}`, title: "New Organizer", message: `${o.organization || o.full_name} applied for an account.` });
      }
    });
    events.forEach((e) => {
      const st = norm(e.status);
      if ((st === "pending" || st === "under review" || st === "requirements submitted") && !dismissedNotifs.has(`ev-${e.id}`)) {
        notifs.push({ id: `ev-${e.id}`, title: "Event Proposal Update", message: `${e.event_name} requires your review.` });
      }
      if (st === "cancellation requested" && !dismissedNotifs.has(`cancel-${e.id}`)) {
        notifs.push({ id: `cancel-${e.id}`, title: "Cancellation Request", message: `${e.event_name} wants to cancel.` });
      }
    });
    return notifs;
  }, [organizers, events, dismissedNotifs]);

  const pendingOrganizersList = useMemo(
    () => organizers.filter((o) => (o.status === "Pending" || !o.status) && !dismissedNotifs.has(`org-${o.id}`)),
    [organizers, dismissedNotifs]
  );

  const pendingEventsList = useMemo(
    () =>
      events.filter((e) => {
        const st = norm(e.status);
        return (st === "pending" || st === "under review" || st === "requirements submitted") && !dismissedNotifs.has(`ev-${e.id}`);
      }),
    [events, dismissedNotifs]
  );

  const cancellationRequestsList = useMemo(
    () => events.filter((e) => norm(e.status) === "cancellation requested"),
    [events]
  );

  const activeCancellationRequests = useMemo(
    () => cancellationRequestsList.filter((e) => !dismissedNotifs.has(`cancel-${e.id}`)).length,
    [cancellationRequestsList, dismissedNotifs]
  );

  const verifiedOrganizersCount = useMemo(
    () => organizers.filter((o) => o.status === "Approved").length,
    [organizers]
  );

  const activeEventsCount = useMemo(
    () => events.filter((e) => e.status === "Approved" || e.status === "Upcoming" || e.status === "Ongoing").length,
    [events]
  );

  const filteredEvents = useMemo(
    () => events.filter((e) => matchesEventFilter(e, eventStatusFilter)),
    [events, eventStatusFilter]
  );

  const totalOrganizersCount = organizers.length;
  const activePendingOrganizersCount = pendingOrganizersList.length;
  const totalEventsCount = events.length;
  const activePendingEventsCount = pendingEventsList.length;
  const totalPendingApprovals = activePendingOrganizersCount + activePendingEventsCount;
  const totalTouristsCount = tourists.length;

  const liveOrganizer = viewingProfileOrganizer
    ? organizers.find((o) => o.id === viewingProfileOrganizer.id) || viewingProfileOrganizer
    : null;

  const organizerEvents = useMemo(
    () => (liveOrganizer ? events.filter((e) => eventBelongsToOrganizer(e, liveOrganizer)) : []),
    [liveOrganizer, events]
  );

  const organizerAttendees = useMemo(() => {
    if (!liveOrganizer) return [];
    const organizerEventIds = new Set(organizerEvents.map((e) => String(e.id)));
    return registrations.filter((r) => organizerEventIds.has(String(r.event_id)) && regState(r) === "confirmed");
  }, [liveOrganizer, organizerEvents, registrations]);

  const deepDiveRows = useMemo(() => organizerAttendees.flatMap(expandRegistration), [organizerAttendees]);

  const selectedDeepDiveEvent = organizerEvents.find((e) => String(e.id) === String(adminSelectedEvent));
  const deepDiveTeamNames = useMemo(
    () => [
      ...new Set(
        organizerAttendees
          .filter((r) => String(r.event_id) === String(adminSelectedEvent) && r.team_name)
          .map((r) => r.team_name)
      ),
    ],
    [organizerAttendees, adminSelectedEvent]
  );
  const showTeamFilter =
    !!selectedDeepDiveEvent && (regTypeOf(selectedDeepDiveEvent) === "group" || deepDiveTeamNames.length > 0);
  const showTeamColumn = deepDiveRows.some((r) => r.team_name);

  const filteredDeepDiveAttendees = useMemo(
    () =>
      deepDiveRows.filter((a) => {
        if (adminSelectedEvent !== "All" && String(a.event_id) !== String(adminSelectedEvent)) return false;
        if (adminGenderFilter !== "All" && a.gender?.toLowerCase() !== adminGenderFilter.toLowerCase()) return false;
        if (showTeamFilter && adminTeamFilter !== "All" && a.team_name !== adminTeamFilter) return false;

        const age = parseInt(a.age, 10) || 0;
        if (adminAgeFilter === "Youth (1-17)" && age >= 18) return false;
        if (adminAgeFilter === "Adult (18-59)" && (age < 18 || age > 59)) return false;
        if (adminAgeFilter === "Senior (60+)" && age < 60) return false;

        return true;
      }),
    [deepDiveRows, adminSelectedEvent, adminGenderFilter, showTeamFilter, adminTeamFilter, adminAgeFilter]
  );

  const userQuery = userSearch.trim().toLowerCase();
  const shownTourists = useMemo(() => tourists.filter((u) => accountMatches(u, userQuery)), [tourists, userQuery]);
  const shownOrganizers = useMemo(() => organizers.filter((u) => accountMatches(u, userQuery)), [organizers, userQuery]);

  const reviewingEvent = reviewingEventId ? events.find((e) => String(e.id) === String(reviewingEventId)) : null;

  return (
    <div className="daet-ui">
      {notifications.length > 0 && (
        <div className="fixed top-6 right-6 z-50 space-y-3 w-[320px] max-w-[90vw]">
          {notifications.slice(0, 4).map((n) => (
            <div key={n.id} className="bg-white border border-gray-200 shadow-xl rounded-2xl p-4 relative flex gap-3 items-start animate-fade-in">
              <div className="flex-1 min-w-0">
                <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{n.title}</h4>
                <p className="text-xs font-semibold text-gray-500 mt-1 leading-snug">{n.message}</p>
              </div>
              <button onClick={() => dismissNotification(n.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1" aria-label="Dismiss">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          ))}
          {notifications.length > 4 && (
            <div className="text-center text-[10px] font-bold text-gray-500 bg-white/80 backdrop-blur-sm rounded-xl py-2 shadow-sm border border-gray-100">
              + {notifications.length - 4} more alerts
            </div>
          )}
        </div>
      )}

      <DashboardShell
        roleLabel="Municipal Tourism Office"
        name="Admin control center"
        subtitle="Daet tourism programs"
        activeKey={activeTab}
        onNavigate={setActiveTab}
        nav={[
          { key: "overview", label: "Overview", icon: "home" },
          { key: "organizer-approvals", label: "Organizer verifications", icon: "shield", badge: activePendingOrganizersCount, tone: "amber" },
          { key: "event-approvals", label: "Event proposals", icon: "calendar-check", badge: activePendingEventsCount, tone: "amber" },
          { key: "calendar", label: "Event calendar", icon: "calendar" },
          { key: "cancellation-requests", label: "Cancellation requests", icon: "x-circle", badge: activeCancellationRequests, tone: "red" },
          { key: "user-management", label: "Users", icon: "users" },
          { key: "admin-settings", label: "Profile and settings", icon: "settings" },
        ]}
        primaryAction={{ label: "View public programs", href: "/programs" }}
        onLogout={async () => {
          await supabase.auth.signOut();
          router.push("/login");
        }}
      >
        {loading && (
          <div className="text-center py-16 text-gray-400 text-xs font-bold uppercase tracking-widest">
            Synchronizing database records...
          </div>
        )}

        {!loading && activeTab === "overview" && (
          <div className="space-y-8">
            <div className="flex justify-between items-center dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">System Overview Dashboard</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Real-time portal metrics across Daet Municipal Tourism Operations</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setActiveTab("organizer-approvals")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                  Review Organizers ({activePendingOrganizersCount})
                </button>
                <button onClick={() => setActiveTab("event-approvals")} className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-xl transition-all shadow-sm">
                  Review Events ({activePendingEventsCount})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="dash-stat">
                <span className="dash-stat-label text-gray-400">Total Organizers</span>
                <p className="dash-stat-value text-slate-900">{totalOrganizersCount}</p>
                <div className="text-[11px] font-semibold text-gray-500 flex justify-between pt-2 border-t border-gray-100">
                  <span>Verified: <strong className="text-emerald-700">{verifiedOrganizersCount}</strong></span>
                  <span>Pending: <strong className="text-amber-600">{activePendingOrganizersCount}</strong></span>
                </div>
              </div>

              <div className="dash-stat">
                <span className="dash-stat-label text-amber-700">Pending Approvals</span>
                <p className="dash-stat-value text-amber-700">{totalPendingApprovals}</p>
                <div className="text-[11px] font-semibold text-gray-500 flex justify-between pt-2 border-t border-amber-100">
                  <span>Accounts: <strong className="text-amber-800">{activePendingOrganizersCount}</strong></span>
                  <span>Events: <strong className="text-amber-800">{activePendingEventsCount}</strong></span>
                </div>
              </div>

              <div className="dash-stat">
                <span className="dash-stat-label text-gray-400">Total Events</span>
                <p className="dash-stat-value text-blue-900">{totalEventsCount}</p>
                <div className="text-[11px] font-semibold text-gray-500 pt-2 border-t border-gray-100">
                  Active / Published: <strong className="text-emerald-700">{activeEventsCount}</strong>
                </div>
              </div>

              <div className="dash-stat">
                <span className="dash-stat-label text-gray-400">System Users / Tourist</span>
                <p className="dash-stat-value text-slate-900">{totalTouristsCount}</p>
                <div className="text-[11px] font-semibold text-gray-500 pt-2 border-t border-gray-100">
                  Registered Tourists
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-sm uppercase">Pending Organizer Applications</h3>
                  <button onClick={() => setActiveTab("organizer-approvals")} className="text-xs text-blue-900 font-bold hover:underline">
                    View All →
                  </button>
                </div>
                {activePendingOrganizersCount === 0 ? (
                  <p className="text-xs text-gray-400 font-semibold py-4 text-center">No pending organizer account applications.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingOrganizersList.slice(0, 3).map((org) => (
                      <div key={org.id} className="p-3.5 bg-gray-50 rounded-xl flex justify-between items-center text-xs">
                        <div>
                          <p className="font-bold text-slate-900">{org.organization || org.full_name}</p>
                          <p className="text-[10px] text-gray-500">{org.email}</p>
                        </div>
                        <button
                          onClick={() => setInspectingOrganizer(org)}
                          className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-[10px] font-bold uppercase shadow-sm transition-all whitespace-nowrap"
                        >
                          Inspect & Verify
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-sm uppercase">Event Proposals Needing Review</h3>
                  <button onClick={() => setActiveTab("event-approvals")} className="text-xs text-blue-900 font-bold hover:underline">
                    View All →
                  </button>
                </div>
                {activePendingEventsCount === 0 ? (
                  <p className="text-xs text-gray-400 font-semibold py-4 text-center">No event proposals awaiting review.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingEventsList.slice(0, 3).map((event) => {
                      const hasDuplicates = (duplicatesByEventId.get(String(event.id)) || []).length > 0;
                      return (
                        <div key={event.id} className="p-3.5 bg-gray-50 rounded-xl flex justify-between items-center gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">{event.event_name}</p>
                            <p className="text-[10px] text-gray-500">
                              Status: {event.status}
                              {hasDuplicates && <span className="ml-2 text-amber-700 font-black">• Similar event exists</span>}
                            </p>
                          </div>
                          {event.status === "Requirements Submitted" ? (
                            <button
                              onClick={() => setActiveTab("event-approvals")}
                              className="px-3.5 py-2 bg-cyan-700 hover:bg-cyan-800 text-white rounded-xl text-[10px] font-bold uppercase transition-all whitespace-nowrap"
                            >
                              Review files
                            </button>
                          ) : (
                            <button
                              onClick={() => updateEventStatus(event.id, "Approved")}
                              disabled={busyActionId === event.id}
                              className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl text-[10px] font-bold uppercase shadow-sm transition-all whitespace-nowrap"
                            >
                              {busyActionId === event.id ? "Approving..." : "Approve"}
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
        )}

        {!loading && activeTab === "organizer-approvals" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Organizer Approvals & Verifications</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Inspect organizer accounts, valid ID, logo, BIR TIN photo, DTI/SEC photo, and business permit photo.</p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                ← Back to Overview
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-gray-200 font-bold uppercase text-gray-500">
                    <tr>
                      <th className="p-4">Organization & Logo</th>
                      <th className="p-4">Representative Info</th>
                      <th className="p-4">Contact & Type</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                    {organizers.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="p-8 text-center text-gray-400 font-bold uppercase">
                          No organizer applications found.
                        </td>
                      </tr>
                    ) : (
                      organizers.map((org) => {
                        const resolvedLogo = getImageUrl(org.logo_url);
                        return (
                          <tr key={org.id}>
                            <td className="p-4 flex items-center gap-3">
                              {resolvedLogo && (
                                <img
                                  src={resolvedLogo}
                                  alt="Logo"
                                  className="w-10 h-10 object-cover rounded-lg border"
                                  onError={(e) => handleImageFallback(e, 200)}
                                />
                              )}
                              <div>
                                <p className="font-bold text-slate-900">{org.organization || "Independent Host"}</p>
                                <p className="text-[10px] text-gray-500">{org.email}</p>
                              </div>
                            </td>
                            <td className="p-4">
                              <p>{org.organizer_full_name || org.full_name}</p>
                              <p className="text-[11px] text-gray-500">{org.address || "No address"}</p>
                            </td>
                            <td className="p-4 space-y-0.5 text-[11px]">
                              <p><strong>Type:</strong> {org.org_type || "N/A"}</p>
                              <p><strong>Phone:</strong> {org.contact_number || "N/A"}</p>
                            </td>
                            <td className="p-4">
                              <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase ${
                                org.status === "Approved" ? "bg-emerald-100 text-emerald-800" :
                                org.status === "Rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                              }`}>
                                {org.status === "Approved" ? "Verified" : org.status === "Rejected" ? "Rejected" : "Pending"}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-1.5">
                                <button
                                  onClick={() => setInspectingOrganizer(org)}
                                  className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap"
                                >
                                  Inspect Documents
                                </button>
                                {org.status === "Approved" && (
                                  <button
                                    onClick={() => openOrganizerDeepDive(org)}
                                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap"
                                  >
                                    View Profile & Events
                                  </button>
                                )}
                                {org.status !== "Rejected" && (
                                  <button
                                    onClick={() => setFeedbackModal({ isOpen: true, type: "reject-organizer", targetId: org.id, reason: "" })}
                                    className="px-3.5 py-2 bg-gray-100 hover:bg-red-800 hover:text-white text-gray-700 rounded-xl font-bold text-[10px] uppercase transition-all text-center whitespace-nowrap"
                                  >
                                    Reject
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === "event-approvals" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Event Proposals Management Hub</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Evaluate event details, manage compliance, and handle event proposals.</p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all whitespace-nowrap">
                ← Back to Overview
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-2xl border border-gray-200 w-fit max-w-full">
              {EVENT_FILTERS.map((f) => {
                const count = events.filter((e) => matchesEventFilter(e, f)).length;
                return (
                  <button
                    key={f}
                    onClick={() => setEventStatusFilter(f)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      eventStatusFilter === f ? "bg-blue-900 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {f} <span className={eventStatusFilter === f ? "text-blue-100" : "text-gray-400"}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {filteredEvents.map((event) => {
                const st = norm(event.status);
                const isCancelled = st === "cancelled";
                const isApproved = st === "approved" || st === "upcoming" || st === "ongoing" || st === "completed";
                const eventRegs = registrationsByEvent.get(String(event.id)) || [];
                const eventRegCount = eventRegs.filter((r) => regState(r) === "confirmed").length;
                const eventPendingRegCount = eventRegs.filter((r) => regState(r) === "pending").length;
                const approvalFiles = Array.isArray(event.approval_files) ? event.approval_files : [];
                const requirementFiles = Array.isArray(event.requirement_files) ? event.requirement_files : [];
                const showLetterPanel = approvalFiles.length > 0 || !!event.approval_instructions;
                const showSubmissionPanel = requirementFiles.length > 0 || !!event.requirement_note;
                const eventImages = getImageList(event.image_url);
                const duplicateMatches = duplicatesByEventId.get(String(event.id)) || [];
                const isBusy = busyActionId === event.id;

                return (
                  <div key={event.id} className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col md:flex-row justify-between gap-5 shadow-sm">
                    <EventMedia images={eventImages} onPreview={setViewerSrc} />

                    <div className="space-y-3 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-black text-slate-900 text-base">
                          <button type="button" onClick={() => { setReviewTab("details"); setReviewingEventId(event.id); }} className="text-left hover:text-blue-900 hover:underline">
                            {event.event_name}
                          </button>
                        </h3>
                        <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase ${statusBadgeClass(event.status)}`}>
                          {event.status || "Pending"}
                        </span>
                        <span className="px-2.5 py-1 rounded-full font-black text-[10px] uppercase bg-slate-100 text-slate-700">
                          {REG_TYPE_LABEL[regTypeOf(event)]}
                        </span>
                      </div>

                      {duplicateMatches.length > 0 && (
                        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-900 space-y-1">
                          <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                            Warning: Existing Matching Event Detected ({duplicateMatches.length})
                          </p>
                          <p className="font-medium">
                            Matches{" "}
                            {duplicateMatches
                              .slice(0, 2)
                              .map((m) => `"${m.event_name}" (${m.status || "Pending"}, ${m.event_date || "TBA"} at ${m.venue || "TBA"})`)
                              .join(" and ")}
                            . Verify before approving to avoid duplicate schedules.
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-gray-600 leading-relaxed">{event.description || "No description provided."}</p>

                      <div className="text-xs text-gray-500 font-semibold space-y-1 bg-gray-50 p-3 rounded-xl">
                        <p><strong>Organizer:</strong> {event.organizer_name || "N/A"}</p>
                        <p><strong>Venue Location:</strong> {event.venue || "TBA"}</p>
                        <p><strong>Proposed Date:</strong> {event.event_date || "TBA"}</p>
                        <p><strong>Time:</strong> {formatTimeRange(event) || "Not set"}</p>
                        <p><strong>Registration fee:</strong> {event.is_paid ? `${peso(event.fee_amount)} (paid event)` : "Free"}</p>
                        <p>
                          <strong>Registered participants:</strong> {eventRegCount}
                          {eventPendingRegCount > 0 && <span className="text-amber-700"> ({eventPendingRegCount} awaiting payment confirmation)</span>}
                        </p>
                        {event.rejection_reason && <p className="text-red-600"><strong>Rejection Reason:</strong> {event.rejection_reason}</p>}
                        {event.revision_notes && <p className="text-indigo-700"><strong>Requires Changes Notes:</strong> {event.revision_notes}</p>}
                      </div>

                      {showLetterPanel && (
                        <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[10px] font-black text-teal-800 uppercase tracking-wider">Approval letter sent to organizer</p>
                            {event.approval_sent_at && (
                              <span className="text-[10px] text-teal-700 font-semibold">{new Date(event.approval_sent_at).toLocaleString()}</span>
                            )}
                          </div>
                          {event.approval_instructions && (
                            <p className="text-xs text-teal-900 font-medium whitespace-pre-line">{event.approval_instructions}</p>
                          )}
                          <AttachmentList files={approvalFiles} onPreview={setViewerSrc} emptyText="No file attached to this letter." />
                        </div>
                      )}

                      {showSubmissionPanel && (
                        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[10px] font-black text-cyan-800 uppercase tracking-wider">Requirements submitted by organizer</p>
                            {event.requirement_submitted_at && (
                              <span className="text-[10px] text-cyan-700 font-semibold">{new Date(event.requirement_submitted_at).toLocaleString()}</span>
                            )}
                          </div>
                          {event.requirement_note && (
                            <p className="text-xs text-cyan-900 font-medium whitespace-pre-line">
                              <strong>Organizer statement:</strong> {event.requirement_note}
                            </p>
                          )}
                          <AttachmentList files={requirementFiles} onPreview={setViewerSrc} emptyText="The organizer did not attach any files." />
                        </div>
                      )}

                      {isApproved && (
                        <p className="text-[11px] font-semibold text-gray-500 bg-blue-50/60 border border-blue-100 rounded-xl px-3 py-2">
                          Event progress updates automatically from the date and time the organizer set
                          {event.event_time ? ` (starts ${formatTime(event.event_time)})` : ""}. Current stage: <strong className="text-blue-900">{event.status}</strong>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col justify-center gap-2 md:min-w-[180px]">
                      <button
                        onClick={() => { setReviewTab("details"); setReviewingEventId(event.id); }}
                        className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all shadow-sm"
                      >
                        Review full details
                      </button>
                      {!isCancelled && (
                        <>
                          <button
                            onClick={() => updateEventStatus(event.id, "Approved")}
                            disabled={isApproved || isBusy}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-100 disabled:text-blue-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs shadow-sm transition-all"
                          >
                            {isApproved ? "Approved" : isBusy ? "Updating..." : "Approve Event"}
                          </button>
                          <button
                            onClick={() => setFeedbackModal({ isOpen: true, type: "revision-event", targetId: event.id, reason: "" })}
                            disabled={isBusy}
                            className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-xs transition-all"
                          >
                            Requires Changes
                          </button>
                          <button
                            onClick={() => openApprovalModal(event)}
                            disabled={isBusy}
                            className="w-full py-2.5 bg-teal-50 hover:bg-teal-100 disabled:opacity-60 text-teal-800 border border-teal-200 rounded-xl font-bold text-xs transition-all"
                          >
                            {approvalFiles.length > 0 || event.approval_instructions ? "Send New Approval Letter" : "Send Approval Letter"}
                          </button>
                          <button
                            onClick={() => setFeedbackModal({ isOpen: true, type: "reject-event", targetId: event.id, reason: "" })}
                            disabled={isBusy}
                            className="w-full py-2.5 bg-white hover:bg-red-50 disabled:opacity-60 text-red-600 border border-red-200 rounded-xl font-bold text-xs transition-all"
                          >
                            Reject Event
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => deleteEvent(event.id)}
                        disabled={isBusy}
                        className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-600 rounded-xl font-bold text-xs transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}

              {events.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                  No event proposals have been submitted yet.
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center space-y-3">
                  <p className="text-gray-400 text-xs font-bold uppercase">
                    No event proposals match the “{eventStatusFilter}” filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => setEventStatusFilter("All")}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
                  >
                    Show All Events
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {!loading && activeTab === "calendar" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Official Event Calendar</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Click any month to view its complete schedule and full event list, or select a date to inspect all events scheduled on that day.
                </p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all whitespace-nowrap"
              >
                ← Back to Overview
              </button>
            </div>

            <EventCalendar
              events={events}
              role="admin"
              onSelectEvent={(ev) => {
                setReviewTab("details");
                setReviewingEventId(ev.id);
              }}
            />
          </div>
        )}

        {!loading && activeTab === "cancellation-requests" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Event Cancellation Requests Queue</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Review reasons submitted by organizers and approve or reject event cancellations.</p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                ← Back to Overview
              </button>
            </div>

            {cancellationRequestsList.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                No active event cancellation requests pending review.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {cancellationRequestsList.map((event) => {
                  const cancelImages = getImageList(event.image_url);
                  const isBusy = busyActionId === event.id;
                  return (
                    <div key={event.id} className="bg-white rounded-2xl border border-red-200 p-5 flex flex-col md:flex-row justify-between gap-5 shadow-sm">
                      <EventMedia images={cancelImages} onPreview={setViewerSrc} />
                      <div className="space-y-3 flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="font-black text-slate-900 text-base">{event.event_name}</h3>
                          <span className="px-2.5 py-1 rounded-full font-black text-[10px] uppercase bg-red-100 text-red-800">
                            Cancellation Requested
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">{event.description}</p>
                        <div className="text-xs text-gray-700 font-semibold space-y-1 bg-red-50 p-4 rounded-xl border border-red-100">
                          <p><strong>Organizer Host:</strong> {event.organizer_name || "N/A"}</p>
                          <p><strong>Event Date:</strong> {event.event_date || "TBA"}{formatTimeRange(event) ? ` | ${formatTimeRange(event)}` : ""} | Venue: {event.venue || "TBA"}</p>
                          <p className="text-red-700 pt-1 border-t border-red-200">
                            <strong>Cancellation Reason Provided:</strong> {event.rejection_reason || "No reason stated."}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col justify-center gap-2.5 min-w-[200px]">
                        <button
                          onClick={() => handleApproveCancellation(event)}
                          disabled={isBusy}
                          className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-bold text-xs shadow-sm transition-all"
                        >
                          {isBusy ? "Processing..." : "Approve Cancellation"}
                        </button>
                        <button
                          onClick={() => setFeedbackModal({ isOpen: true, type: "reject-cancellation", targetId: event.id, reason: "" })}
                          disabled={isBusy}
                          className="w-full py-2.5 bg-white hover:bg-red-50 disabled:opacity-60 text-red-600 border border-red-200 rounded-xl font-bold text-xs transition-all"
                        >
                          Reject Cancellation
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "user-management" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center dash-pagehead">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">System User Management</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Manage and inspect tourist and organizer accounts.</p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                ← Back to Overview
              </button>
            </div>

            <div className="relative">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search accounts by name, organization, email, phone or address..."
                aria-label="Search accounts"
                className="w-full pl-11 pr-24 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {userSearch && (
                <button
                  type="button"
                  onClick={() => setUserSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[10px] font-bold uppercase transition-all"
                >
                  Clear
                </button>
              )}
            </div>
            {userQuery && (
              <p className="text-xs text-gray-500 font-semibold -mt-3">
                {shownTourists.length} of {tourists.length} tourist accounts and {shownOrganizers.length} of {organizers.length} organizer accounts match “{userSearch.trim()}”.
              </p>
            )}

            <div className="flex gap-2 border-b border-gray-200 pb-3">
              <button
                onClick={() => setUserManagementSubTab("tourists")}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${
                  userManagementSubTab === "tourists"
                    ? "bg-blue-900 text-white shadow-md"
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                Tourist Accounts ({userQuery ? `${shownTourists.length}/${tourists.length}` : tourists.length})
              </button>
              <button
                onClick={() => setUserManagementSubTab("organizers")}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${
                  userManagementSubTab === "organizers"
                    ? "bg-blue-900 text-white shadow-md"
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                Organizer Accounts ({userQuery ? `${shownOrganizers.length}/${organizers.length}` : organizers.length})
              </button>
            </div>

            {userManagementSubTab === "tourists" && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="p-4 bg-slate-50 border-b border-gray-200 font-bold text-slate-900 text-xs uppercase">
                  Registered Tourist Accounts
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 font-bold uppercase text-gray-500">
                      <tr>
                        <th className="p-4">Name</th>
                        <th className="p-4">Phone Number</th>
                        <th className="p-4">Email</th>
                        <th className="p-4">Age</th>
                        <th className="p-4">Sex</th>
                        <th className="p-4">Address</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                      {shownTourists.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="p-8 text-center text-gray-400 font-bold uppercase">
                            {userQuery ? "No tourist accounts match your search." : "No tourist accounts found."}
                          </td>
                        </tr>
                      ) : (
                        shownTourists.map((usr) => (
                          <tr key={usr.id}>
                            <td className="p-4 font-bold text-slate-900">{usr.full_name || "Unnamed Tourist"}</td>
                            <td className="p-4">{usr.contact_number || usr.phone || "N/A"}</td>
                            <td className="p-4">{usr.email}</td>
                            <td className="p-4">{usr.age || "N/A"}</td>
                            <td className="p-4">{usr.sex || usr.gender || "N/A"}</td>
                            <td className="p-4">{usr.address || usr.home_address || "N/A"}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                usr.is_suspended ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                              }`}>
                                {usr.is_suspended ? "Suspended" : "Active"}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-1.5">
                                <button
                                  onClick={() => setViewingAccount({ kind: "tourist", data: usr })}
                                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap"
                                >
                                  View Account
                                </button>
                                <button
                                  onClick={() => handleToggleUserSuspension(usr.id, usr.is_suspended)}
                                  disabled={busyActionId === usr.id}
                                  className={`px-3.5 py-2 rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap disabled:opacity-60 ${
                                    usr.is_suspended ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-100 hover:bg-red-200 text-red-700"
                                  }`}
                                >
                                  {usr.is_suspended ? "Reactivate" : "Suspend Account"}
                                </button>
                                <button
                                  onClick={() => handleDeleteAccount(usr, "tourist")}
                                  disabled={deletingId === usr.id}
                                  className="px-3.5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap"
                                >
                                  {deletingId === usr.id ? "Deleting..." : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {userManagementSubTab === "organizers" && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="p-4 bg-slate-50 border-b border-gray-200 font-bold text-slate-900 text-xs uppercase">
                  Registered Organizer Accounts
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 font-bold uppercase text-gray-500">
                      <tr>
                        <th className="p-4">Name / Org</th>
                        <th className="p-4">Phone Number</th>
                        <th className="p-4">Email</th>
                        <th className="p-4">Age</th>
                        <th className="p-4">Sex</th>
                        <th className="p-4">Address</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                      {shownOrganizers.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="p-8 text-center text-gray-400 font-bold uppercase">
                            {userQuery ? "No organizer accounts match your search." : "No organizer accounts found."}
                          </td>
                        </tr>
                      ) : (
                        shownOrganizers.map((org) => (
                          <tr key={org.id}>
                            <td className="p-4 font-bold text-slate-900">
                              {org.organization ? `${org.organization} (${org.organizer_full_name || org.full_name})` : (org.full_name || "Unnamed Organizer")}
                            </td>
                            <td className="p-4">{org.contact_number || org.phone || "N/A"}</td>
                            <td className="p-4">{org.email}</td>
                            <td className="p-4">{org.age || "N/A"}</td>
                            <td className="p-4">{org.sex || org.gender || "N/A"}</td>
                            <td className="p-4">{org.address || "N/A"}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                org.is_suspended ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                              }`}>
                                {org.is_suspended ? "Suspended" : "Active"}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-1.5">
                                <button
                                  onClick={() => setViewingAccount({ kind: "organizer", data: org })}
                                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap"
                                >
                                  View Account
                                </button>
                                <button
                                  onClick={() => handleToggleUserSuspension(org.id, org.is_suspended)}
                                  disabled={busyActionId === org.id}
                                  className={`px-3.5 py-2 rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap disabled:opacity-60 ${
                                    org.is_suspended ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-100 hover:bg-red-200 text-red-700"
                                  }`}
                                >
                                  {org.is_suspended ? "Reactivate" : "Suspend Account"}
                                </button>
                                <button
                                  onClick={() => handleDeleteAccount(org, "organizer")}
                                  disabled={deletingId === org.id}
                                  className="px-3.5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm text-center whitespace-nowrap"
                                >
                                  {deletingId === org.id ? "Deleting..." : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "admin-settings" && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] py-10">
            <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-gray-200 shadow-xl space-y-6">
              <div className="text-center border-b border-gray-100 pb-4 relative">
                <button onClick={() => setActiveTab("overview")} className="absolute left-0 top-1 text-gray-400 hover:text-gray-900 transition-colors" aria-label="Back">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Admin Profile</h1>
                <p className="text-[11px] text-gray-500 font-semibold mt-1 uppercase tracking-widest">Municipal Tourism Office Settings</p>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!adminPassword) return notify("Please enter a new password first.");
                  setSavingPassword(true);
                  try {
                    const { error } = await supabase.auth.updateUser({ password: adminPassword });
                    if (error) {
                      notify("Error updating password: " + error.message);
                    } else {
                      setNewPassword("");
                      setPwSaved(true);
                      setTimeout(() => setPwSaved(false), 2000);
                    }
                  } finally {
                    setSavingPassword(false);
                  }
                }}
                className="space-y-5 text-xs font-semibold"
              >
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1.5 font-bold uppercase tracking-wider text-center">OFFICIAL ADMIN EMAIL</label>
                  <input type="email" disabled value={adminEmail} className="w-full p-3.5 bg-gray-100 border border-gray-200 rounded-xl font-bold text-slate-700 text-center cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1.5 font-bold uppercase tracking-wider text-center">UPDATE PASSWORD</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={adminPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-center transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="w-full py-3.5 mt-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-black uppercase tracking-wider shadow-md hover:shadow-lg transition-all"
                >
                  {savingPassword ? "Saving..." : pwSaved ? "Saved ✓" : "Save Admin Settings"}
                </button>
              </form>
            </div>
          </div>
        )}
      </DashboardShell>

      {inspectingOrganizer && (
        <ModalBackdrop maxWidth="max-w-3xl">
          <div className="flex justify-between items-center border-b pb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase">
                Organizer Verification Documents: {inspectingOrganizer.organization}
              </h3>
              <p className="text-gray-500 font-medium">Review attached credibility credentials and photos</p>
            </div>
            <button onClick={() => setInspectingOrganizer(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all">← Back</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "BIR TIN (TAX ID) PHOTO", alt: "BIR TIN Document", value: inspectingOrganizer.bir_tin, empty: "No BIR TIN photo uploaded" },
              { label: "DTI / SEC REGISTRATION PHOTO", alt: "DTI/SEC Document", value: inspectingOrganizer.dti_sec_reg, empty: "No DTI/SEC photo uploaded" },
              { label: "BUSINESS PERMIT PHOTO", alt: "Business Permit", value: inspectingOrganizer.business_permit_no, empty: "No Business Permit photo uploaded" },
              { label: "REPRESENTATIVE VALID ID", alt: "Valid ID", value: inspectingOrganizer.valid_id_url, empty: "No Valid ID uploaded" },
              { label: "ORGANIZATION LOGO", alt: "Logo", value: inspectingOrganizer.logo_url, empty: "No Logo uploaded", span: "md:col-span-2" },
            ].map((doc) => {
              const docUrl = getImageUrl(doc.value);
              return (
                <div key={doc.label} className={doc.span || ""}>
                  <p className="text-gray-600 mb-1 font-bold">{doc.label}</p>
                  {doc.value ? (
                    <button type="button" onClick={() => setViewerSrc(docUrl)} className="block w-full" aria-label={`View full ${doc.alt}`}>
                      <img
                        src={docUrl}
                        alt={doc.alt}
                        className="w-full h-40 object-cover rounded-xl border shadow-sm hover:opacity-90"
                        onError={(e) => handleImageFallback(e, 600)}
                      />
                    </button>
                  ) : (
                    <div className="p-8 bg-gray-50 border rounded-xl text-center text-gray-400">{doc.empty}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-2 bg-gray-50 p-4 rounded-xl">
            <p><strong>Representative Full Name:</strong> {inspectingOrganizer.organizer_full_name || inspectingOrganizer.full_name}</p>
            <p><strong>Email Address:</strong> {inspectingOrganizer.email}</p>
            <p><strong>Contact Number:</strong> {inspectingOrganizer.contact_number || "N/A"}</p>
            <p><strong>Organization Type:</strong> {inspectingOrganizer.org_type || "N/A"}</p>
            <p><strong>Office Address:</strong> {inspectingOrganizer.address || "N/A"}</p>
            <p><strong>Website / Social Media:</strong> {inspectingOrganizer.website_link || "N/A"}</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => handleApproveOrganizer(inspectingOrganizer.id)}
              disabled={busyActionId === inspectingOrganizer.id}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl uppercase shadow-sm transition-all"
            >
              {busyActionId === inspectingOrganizer.id ? "Approving..." : "Approve & Verify Organizer Account"}
            </button>
            <button
              onClick={() => {
                const targetId = inspectingOrganizer.id;
                setInspectingOrganizer(null);
                setFeedbackModal({ isOpen: true, type: "reject-organizer", targetId, reason: "" });
              }}
              className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-xl uppercase transition-all"
            >
              Reject Application
            </button>
          </div>
        </ModalBackdrop>
      )}

      {reviewingEvent && (() => {
        const ev = reviewingEvent;
        const regType = regTypeOf(ev);
        const evRegs = registrationsByEvent.get(String(ev.id)) || [];
        const confirmedRegs = evRegs.filter((r) => regState(r) === "confirmed");
        const teamRegs = evRegs.filter((r) => r.team_name || teamMembersOf(r).length > 0);
        const attendeeRows = evRegs.flatMap(expandRegistration);
        const duplicateMatches = duplicatesByEventId.get(String(ev.id)) || [];
        const img = getImageUrl(ev.image_url);
        const proposalFiles = Array.isArray(ev.organizer_proposal_files) ? ev.organizer_proposal_files : [];
        const tabs = [
          ["details", "Details"],
          ...(regType !== "interested" ? [["attendees", `Attendees (${attendeeRows.length})`]] : []),
          ...(regType === "group" ? [["teams", `Teams (${teamRegs.length})`]] : []),
          ...(regType === "interested" ? [["interested", `Interested (${interestedList.loading ? "..." : interestedList.rows.length})`]] : []),
        ];
        const tab = tabs.some(([k]) => k === reviewTab) ? reviewTab : "details";

        return (
          <ModalBackdrop maxWidth="max-w-5xl">
            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-black text-slate-900 uppercase">{ev.event_name}</h3>
                  <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase ${statusBadgeClass(ev.status)}`}>{ev.status || "Pending"}</span>
                  <span className="px-2.5 py-1 rounded-full font-black text-[10px] uppercase bg-slate-100 text-slate-700">{REG_TYPE_LABEL[regType]}</span>
                </div>
                <p className="text-gray-500 font-medium mt-1">Review everything the organizer submitted for this event.</p>
              </div>
              <button onClick={() => setReviewingEventId(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold whitespace-nowrap transition-all">← Back</button>
            </div>

            {duplicateMatches.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 text-xs text-amber-900 space-y-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                  Warning: Existing Matching Event Detected ({duplicateMatches.length})
                </p>
                <p className="font-medium">
                  This proposal shares a title or venue/date with:{" "}
                  {duplicateMatches
                    .map((m) => `"${m.event_name}" (${m.status || "Pending"} · ${formatDate(m.event_date || m.date)} at ${m.venue || "TBA"})`)
                    .join("; ")}
                  .
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 bg-gray-100 p-1.5 rounded-2xl w-fit max-w-full">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setReviewTab(key)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${tab === key ? "bg-white text-blue-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "details" && (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <div className="md:col-span-2 space-y-3">
                  {img ? (
                    <button type="button" onClick={() => setViewerSrc(img)} className="block w-full aspect-[16/9] rounded-xl overflow-hidden bg-slate-100 border border-gray-200" aria-label="View full photo">
                      <img src={img} alt={ev.event_name} className="w-full h-full object-cover" />
                    </button>
                  ) : (
                    <div className="w-full aspect-[16/9] rounded-xl bg-slate-100 flex items-center justify-center text-[10px] text-gray-400 uppercase font-bold">No Photo</div>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-slate-900 uppercase">Proposal documents</p>
                    <AttachmentList files={proposalFiles} onPreview={setViewerSrc} emptyText="No proposal documents were attached." />
                  </div>
                </div>

                <div className="md:col-span-3 space-y-4">
                  <p className="text-gray-700 font-medium leading-relaxed whitespace-pre-line">{ev.description || "No description provided."}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 bg-gray-50 p-4 rounded-xl text-gray-600">
                    <p><strong>Type of event:</strong> {REG_TYPE_LABEL[regType]}</p>
                    <p><strong>Organizer:</strong> {ev.organizer_name || "N/A"}</p>
                    <p><strong>Venue:</strong> {ev.venue || "TBA"}</p>
                    <p><strong>Date:</strong> {formatDate(ev.event_date || ev.date)}</p>
                    <p><strong>Time:</strong> {formatTimeRange(ev) || "Not set"}</p>
                    {regType === "group" && <p><strong>Members per group:</strong> {ev.team_size || "N/A"}</p>}
                    {regType === "group" && <p><strong>Team spots:</strong> {ev.max_slots || "Unlimited"} ({teamRegs.length} registered)</p>}
                    {regType === "single" && <p><strong>Attendee quota:</strong> {ev.max_slots || "Unlimited"}</p>}
                    {regType !== "interested" && (
                      <p><strong>{regType === "group" ? "Fee per team" : "Registration fee"}:</strong> {ev.is_paid ? peso(ev.fee_amount) : "Free"}</p>
                    )}
                    {regType !== "interested" && (
                      <p><strong>Confirmed {regType === "group" ? "teams" : "attendees"}:</strong> {confirmedRegs.length}</p>
                    )}
                    <p><strong>Interested tourists:</strong> {interestedList.loading ? "..." : interestedList.error ? "unavailable" : interestedList.rows.length}</p>
                    {ev.is_paid && ev.cash_payment_details && <p className="sm:col-span-2"><strong>Cash payment:</strong> {ev.cash_payment_details}</p>}
                    {ev.is_paid && ev.online_payment_details && <p className="sm:col-span-2"><strong>Online payment:</strong> {ev.online_payment_details}</p>}
                    {ev.rejection_reason && <p className="sm:col-span-2 text-red-600"><strong>Rejection reason:</strong> {ev.rejection_reason}</p>}
                    {ev.revision_notes && <p className="sm:col-span-2 text-indigo-700"><strong>Requires changes notes:</strong> {ev.revision_notes}</p>}
                  </div>
                </div>
              </div>
            )}

            {tab === "attendees" && (
              attendeeRows.length === 0 ? (
                <div className="p-8 text-center text-gray-400 font-bold uppercase">Nobody has registered for this event yet.</div>
              ) : (
                <div className="border rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 font-bold uppercase text-gray-500 border-b">
                      <tr>
                        <th className="p-3">Serial ID</th>
                        <th className="p-3">Name</th>
                        {regType === "group" && <th className="p-3">Team</th>}
                        <th className="p-3">Contact</th>
                        <th className="p-3">Gender</th>
                        <th className="p-3">Age</th>
                        <th className="p-3">Address</th>
                        <th className="p-3">Registered</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Attendance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-700">
                      {attendeeRows.map((a) => {
                        const att = attendanceBadgeMeta(a.attendance);
                        return (
                          <tr key={a.key}>
                            <td className="p-3 font-mono text-[11px] font-bold text-slate-700 whitespace-nowrap">
                              {a.serial_id || <span className="text-gray-400 font-sans">Pending</span>}
                            </td>
                            <td className="p-3 font-bold text-slate-900">
                              {a.name}
                              {a.isLeader && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[9px] font-black uppercase">Leader</span>}
                            </td>
                            {regType === "group" && <td className="p-3">{a.team_name || "-"}</td>}
                            <td className="p-3">{a.email || "-"}<br /><span className="text-[10px] text-gray-400">{a.phone}</span></td>
                            <td className="p-3">{a.gender}</td>
                            <td className="p-3">{a.age} yrs</td>
                            <td className="p-3">{a.address}</td>
                            <td className="p-3">{a.created_at ? new Date(a.created_at).toLocaleDateString() : "N/A"}</td>
                            <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${regStateBadgeClass(a.status)}`}>{a.status}</span></td>
                            <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${att.cls}`}>{att.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "teams" && (
              teamRegs.length === 0 ? (
                <div className="p-8 text-center text-gray-400 font-bold uppercase">No teams have registered for this event yet.</div>
              ) : (
                <div className="space-y-3">
                  {teamRegs.map((r) => {
                    const teamSerial = resolveRegistrationSerial(r);
                    return (
                      <div key={r.id} className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase">
                          <span className={`px-2 py-0.5 rounded-full ${regStateBadgeClass(regState(r))}`}>{regState(r)}</span>
                          {teamSerial && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-mono">
                              Serial: {teamSerial}
                            </span>
                          )}
                          {r.payment_method && (
                            <span className="text-gray-500">
                              Payment: {r.payment_method}
                              {r.amount_due ? ` · ${peso(r.amount_due)}` : ""}
                              {r.payment_reference ? ` · Ref ${r.payment_reference}` : ""}
                            </span>
                          )}
                          {r.payment_proof_url && (
                            <button type="button" onClick={() => setViewerSrc(getImageUrl(r.payment_proof_url))} className="text-blue-900 hover:underline">View receipt</button>
                          )}
                        </div>
                        <TeamDetails registration={r} onPreview={(url) => setViewerSrc(getImageUrl(url))} />
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {tab === "interested" && (
              interestedList.loading ? (
                <div className="p-8 text-center text-gray-400 font-bold uppercase">Loading interested tourists...</div>
              ) : interestedList.error ? (
                <div className="p-6 text-center text-red-600 bg-red-50 rounded-xl font-bold">
                  Could not load the interested list: {interestedList.error}. Run the SQL file that creates the event_interested_list function.
                </div>
              ) : interestedList.rows.length === 0 ? (
                <div className="p-8 text-center text-gray-400 font-bold uppercase">No tourists have marked this event as interested yet.</div>
              ) : (
                <div className="border rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 font-bold uppercase text-gray-500 border-b">
                      <tr>
                        <th className="p-3">Name</th>
                        <th className="p-3">Email</th>
                        <th className="p-3">Contact</th>
                        <th className="p-3">Marked interested</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-700">
                      {interestedList.rows.map((row) => (
                        <tr key={row.user_id}>
                          <td className="p-3 font-bold text-slate-900">{row.full_name || "Unnamed tourist"}</td>
                          <td className="p-3">{row.email || "-"}</td>
                          <td className="p-3">{row.contact_number || "-"}</td>
                          <td className="p-3">{row.created_at ? new Date(row.created_at).toLocaleDateString() : "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </ModalBackdrop>
        );
      })()}

      {liveOrganizer && (
        <ModalBackdrop maxWidth="max-w-5xl">
          <div className="flex justify-between items-start gap-4 border-b pb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase">
                Organizer Deep-Dive: {liveOrganizer.organization || liveOrganizer.organizer_full_name || liveOrganizer.full_name}
              </h3>
              <p className="text-gray-500 font-medium">Viewing hosted events and participant records</p>
            </div>
            <button onClick={() => setViewingProfileOrganizer(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold whitespace-nowrap transition-all">← Back</button>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-black text-slate-900 uppercase">Hosted events ({organizerEvents.length})</h4>
            {organizerEvents.length === 0 ? (
              <div className="p-6 text-center text-gray-400 font-bold uppercase bg-gray-50 rounded-xl">
                No events found for this organizer yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {organizerEvents.map((ev) => {
                  const evRegs = registrationsByEvent.get(String(ev.id)) || [];
                  const count = evRegs.filter((r) => regState(r) === "confirmed").length;
                  const resolvedEvImages = getImageList(ev.image_url);
                  return (
                    <div key={ev.id} className="flex gap-3 p-3 border border-gray-200 rounded-xl bg-white">
                      <EventMedia
                        images={resolvedEvImages}
                        onPreview={setViewerSrc}
                        className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100"
                        emptyTextClass="text-[9px]"
                      />
                      <div className="min-w-0 space-y-1">
                        <p className="font-black text-slate-900 truncate">{ev.event_name}</p>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusBadgeClass(ev.status)}`}>
                          {ev.status || "Pending"}
                        </span>
                        <p className="text-gray-500 font-medium truncate">{ev.venue || "TBA"} · {formatDate(ev.event_date || ev.date)}</p>
                        <p className="text-gray-700">{count} registered {count === 1 ? "participant" : "participants"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 bg-gray-50 p-4 rounded-xl items-end">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">SELECT EVENT</label>
              <select
                value={adminSelectedEvent}
                onChange={(e) => {
                  setAdminSelectedEvent(e.target.value);
                  setAdminTeamFilter("All");
                }}
                className="p-2 border rounded-xl bg-white"
              >
                <option value="All">All Organizer Events ({organizerEvents.length})</option>
                {organizerEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.event_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 mb-1">GENDER</label>
              <select
                value={adminGenderFilter}
                onChange={(e) => setAdminGenderFilter(e.target.value)}
                className="p-2 border rounded-xl bg-white"
              >
                <option value="All">All Genders</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 mb-1">AGE BRACKET</label>
              <select
                value={adminAgeFilter}
                onChange={(e) => setAdminAgeFilter(e.target.value)}
                className="p-2 border rounded-xl bg-white"
              >
                <option value="All">All Age Brackets</option>
                <option value="Youth (1-17)">Youth (1-17)</option>
                <option value="Adult (18-59)">Adult (18-59)</option>
                <option value="Senior (60+)">Senior (60+)</option>
              </select>
            </div>

            {showTeamFilter && (
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">TEAMS</label>
                <select
                  value={adminTeamFilter}
                  onChange={(e) => setAdminTeamFilter(e.target.value)}
                  className="p-2 border rounded-xl bg-white"
                >
                  <option value="All">All Teams ({deepDiveTeamNames.length})</option>
                  {deepDiveTeamNames.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="ml-auto text-slate-700 font-bold">
              Matching Attendees: {filteredDeepDiveAttendees.length}
            </div>
          </div>

          {filteredDeepDiveAttendees.length === 0 ? (
            <div className="p-8 text-center text-gray-400 font-bold uppercase">
              No participant records found matching the filter criteria.
            </div>
          ) : (
            <div className="border rounded-xl overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 font-bold uppercase text-gray-500 border-b">
                  <tr>
                    <th className="p-3">Serial ID</th>
                    <th className="p-3">Participant Name</th>
                    {showTeamColumn && <th className="p-3">Team</th>}
                    <th className="p-3">Event</th>
                    <th className="p-3">Contact</th>
                    <th className="p-3">Gender</th>
                    <th className="p-3">Age</th>
                    <th className="p-3">Address</th>
                    <th className="p-3">Registered</th>
                    <th className="p-3">Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-gray-700">
                  {filteredDeepDiveAttendees.map((attendee) => {
                    const att = attendanceBadgeMeta(attendee.attendance);
                    return (
                      <tr key={attendee.key}>
                        <td className="p-3 font-mono text-[11px] font-bold text-slate-700 whitespace-nowrap">
                          {attendee.serial_id || "—"}
                        </td>
                        <td className="p-3 font-bold text-slate-900">
                          {attendee.name}
                          {attendee.isLeader && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[9px] font-black uppercase">Leader</span>}
                        </td>
                        {showTeamColumn && <td className="p-3">{attendee.team_name || "-"}</td>}
                        <td className="p-3">{events.find((ev) => String(ev.id) === String(attendee.event_id))?.event_name || "N/A"}</td>
                        <td className="p-3">{attendee.email || "-"}<br /><span className="text-[10px] text-gray-400">{attendee.phone}</span></td>
                        <td className="p-3">{attendee.gender}</td>
                        <td className="p-3">{attendee.age} yrs</td>
                        <td className="p-3">{attendee.address}</td>
                        <td className="p-3">{attendee.created_at ? new Date(attendee.created_at).toLocaleDateString() : "N/A"}</td>
                        <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${att.cls}`}>{att.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ModalBackdrop>
      )}

      {viewingAccount && (() => {
        const acct = viewingAccount.data || {};
        const isOrg = viewingAccount.kind === "organizer";
        const acctEvents = isOrg ? events.filter((e) => eventBelongsToOrganizer(e, acct)) : [];
        const acctRegs = !isOrg ? registrations.filter((r) => r.user_id === acct.id) : [];

        const rows = isOrg
          ? [
              ["Organization", toSafeDisplayValue(acct.organization)],
              ["Representative", toSafeDisplayValue(acct.organizer_full_name || acct.full_name)],
              ["Email", toSafeDisplayValue(acct.email)],
              ["Contact number", toSafeDisplayValue(acct.contact_number || acct.phone)],
              ["Organization type", toSafeDisplayValue(acct.org_type)],
              ["Office address", toSafeDisplayValue(acct.address)],
              ["Website / social media", toSafeDisplayValue(acct.website_link)],
              ["Verification status", toSafeDisplayValue(acct.status) || "Pending"],
              ["Account state", acct.is_suspended ? "Suspended" : "Active"],
              ["Joined", acct.created_at ? formatDate(acct.created_at) : null],
              ...(acct.rejection_reason ? [["Rejection reason", toSafeDisplayValue(acct.rejection_reason)]] : []),
            ]
          : [
              ["Full name", toSafeDisplayValue(acct.full_name)],
              ["Email", toSafeDisplayValue(acct.email)],
              ["Phone number", toSafeDisplayValue(acct.contact_number || acct.phone_number || acct.phone)],
              ["Age", toSafeDisplayValue(acct.age)],
              ["Sex / gender", toSafeDisplayValue(acct.sex || acct.gender)],
              ["Civil status", toSafeDisplayValue(acct.civil_status)],
              ["Home address", toSafeDisplayValue(acct.address || acct.home_address)],
              ["Verification status", toSafeDisplayValue(acct.status)],
              ["Account state", acct.is_suspended ? "Suspended" : "Active"],
              ["Joined", acct.created_at ? formatDate(acct.created_at) : null],
            ];

        const docs = isOrg
          ? [
              ["Organization logo", acct.logo_url],
              ["Representative valid ID", acct.valid_id_url],
              ["Business permit", acct.business_permit_no],
              ["BIR TIN", acct.bir_tin],
              ["DTI / SEC registration", acct.dti_sec_reg],
            ].filter(([, v]) => Boolean(toSafeDisplayValue(v)))
          : [];

        const headingText = isOrg
          ? toSafeDisplayValue(acct.organization || acct.organizer_full_name || acct.full_name) || "Unnamed Organizer"
          : toSafeDisplayValue(acct.full_name) || "Unnamed Tourist";

        return (
          <ModalBackdrop maxWidth="max-w-3xl">
            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div>
                <span className="px-2.5 py-0.5 bg-blue-100 text-blue-900 text-[10px] font-black rounded-full uppercase">
                  {isOrg ? "Organizer account" : "Tourist account"}
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-2">
                  {headingText}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingAccount(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold whitespace-nowrap transition-all"
              >
                ← Back to User Management
              </button>
            </div>

            <dl className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              {rows.map(([label, value], idx) => (
                <div key={`${label}-${idx}`} className="grid grid-cols-3 gap-4 px-4 py-3">
                  <dt className="font-bold text-gray-500">{label}</dt>
                  <dd className="col-span-2 text-slate-800 break-words">
                    {value ? value : <span className="text-gray-300">Not provided</span>}
                  </dd>
                </div>
              ))}
            </dl>

            {isOrg && docs.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-900 uppercase">Submitted documents</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {docs.map(([label, value], idx) => {
                    const resolvedDocUrl = getImageUrl(value);
                    const fallbackText = toSafeDisplayValue(value);
                    return (
                      <div key={`${label}-${idx}`} className="space-y-1">
                        <p className="text-gray-500 font-bold">{label}</p>
                        {isImageSrc(resolvedDocUrl) ? (
                          <button type="button" onClick={() => setViewerSrc(resolvedDocUrl)} className="block w-full" aria-label={`View full ${label}`}>
                            <img
                              src={resolvedDocUrl}
                              alt={label}
                              className="w-full h-28 object-cover rounded-xl border hover:opacity-90"
                              onError={(e) => handleImageFallback(e, 300)}
                            />
                          </button>
                        ) : (
                          <p className="p-3 bg-gray-50 border rounded-xl text-slate-800 break-words">{fallbackText}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isOrg ? (
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-900 uppercase">Hosted events ({acctEvents.length})</h4>
                {acctEvents.length === 0 ? (
                  <p className="p-4 bg-gray-50 rounded-xl text-gray-400 text-center font-bold uppercase">No events yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {acctEvents.map((ev) => (
                      <li key={ev.id} className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-xl">
                        <span className="font-bold text-slate-900 truncate">{toSafeDisplayValue(ev.event_name)}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusBadgeClass(ev.status)}`}>{toSafeDisplayValue(ev.status) || "Pending"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-900 uppercase">Registered events ({acctRegs.length})</h4>
                {acctRegs.length === 0 ? (
                  <p className="p-4 bg-gray-50 rounded-xl text-gray-400 text-center font-bold uppercase">No event registrations.</p>
                ) : (
                  <ul className="space-y-2">
                    {acctRegs.map((r) => {
                      const ev = events.find((e) => String(e.id) === String(r.event_id));
                      return (
                        <li key={r.id} className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-xl">
                          <span className="font-bold text-slate-900 truncate">{toSafeDisplayValue(ev?.event_name) || "Removed event"}</span>
                          <span className="text-gray-500 flex items-center gap-2">
                            {regState(r) !== "confirmed" && (
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${regState(r) === "pending" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                                {regState(r)}
                              </span>
                            )}
                            {ev?.event_date ? formatDate(ev.event_date) : "TBA"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </ModalBackdrop>
        );
      })()}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Photo" onClose={() => setViewerSrc(null)} />}

      {approvalModal.isOpen && (
        <ModalBackdrop maxWidth="max-w-lg" padding="p-6">
          <div>
            <span className="px-2.5 py-1 bg-teal-100 text-teal-800 text-[10px] font-black rounded-full uppercase tracking-wider">
              Approval Letter
            </span>
            <h3 className="text-lg font-black text-slate-900 uppercase mt-2">
              {events.find((e) => e.id === approvalModal.eventId)?.event_name || "Event"}
            </h3>
            <p className="text-gray-500 text-[11px] mt-1">
              The organizer will see this letter, your instructions and the attached files in their dashboard. The event stays
              unpublished until you approve it after they send the requirements.
            </p>
          </div>

          <div>
            <label className="block text-gray-600 mb-1 uppercase">Instructions / statement *</label>
            <textarea
              rows={5}
              placeholder="e.g. Print the attached approval letter and submit it to the Municipal Hall, then upload the stamped copy together with your mayor's permit."
              value={approvalModal.message}
              onChange={(e) => setApprovalModal({ ...approvalModal, message: e.target.value })}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-gray-600 mb-1 uppercase">Attachments (letter, documents, photos)</label>
            <FilePicker
              files={approvalModal.files}
              onChange={(files) => setApprovalModal({ ...approvalModal, files })}
              label="Choose files to send"
              hint="PDF, Word, Excel, images - up to 10MB each"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSendApprovalLetter}
              disabled={sendingApproval}
              className="w-full py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold rounded-xl uppercase shadow-sm transition-all"
            >
              {sendingApproval ? "Uploading & sending..." : "Send to organizer"}
            </button>
            <button
              onClick={closeApprovalModal}
              disabled={sendingApproval}
              className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all"
            >
              ← Back
            </button>
          </div>
        </ModalBackdrop>
      )}

      {feedbackModal.isOpen && (
        <ModalBackdrop maxWidth="max-w-md" padding="p-6">
          <h3 className="text-lg font-black text-slate-900 uppercase">
            {feedbackModal.type === "reject-organizer"
              ? "Reject Organizer Application"
              : feedbackModal.type === "reject-event"
              ? "Reject Event Proposal"
              : feedbackModal.type === "reject-cancellation"
              ? "Deny Cancellation Request"
              : "Provide Event Revision Feedback"}
          </h3>
          <p className="text-gray-500 text-[11px]">
            Please state the official reason or required corrections clearly. This will be visible to the organizer.
          </p>

          <textarea
            rows={4}
            required
            placeholder="Type reason or feedback here..."
            value={feedbackModal.reason}
            onChange={(e) => setFeedbackModal({ ...feedbackModal, reason: e.target.value })}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => {
                if (feedbackModal.type === "reject-organizer") handleRejectOrganizer();
                else handleSubmitEventFeedback();
              }}
              disabled={submittingFeedback}
              className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white font-bold rounded-xl uppercase shadow-sm transition-all"
            >
              {submittingFeedback ? "Submitting..." : "Submit Feedback"}
            </button>
            <button
              onClick={() => setFeedbackModal({ isOpen: false, type: "", targetId: null, reason: "" })}
              disabled={submittingFeedback}
              className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all"
            >
              ← Back
            </button>
          </div>
        </ModalBackdrop>
      )}
      {feedbackUI}
    </div>
  );
}