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
  "relative w-full md:w-56 h-44 md:h-40 flex-shrink-0 self-start rounded-xl overflow-hidden bg-slate-100 group";

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

const norm = (s) => (s || "").trim().toLowerCase();

const getPhase = (status) => {
  const st = norm(status);
  if (st === "ongoing") return "Ongoing";
  if (st === "completed") return "Completed";
  if (st === "rescheduled") return "Rescheduled";
  return "Upcoming";
};

const phaseBadge = {
  Upcoming: "bg-blue-100 text-blue-900",
  Ongoing: "bg-emerald-100 text-emerald-800",
  Rescheduled: "bg-amber-100 text-amber-800",
  Completed: "bg-gray-200 text-gray-700",
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
  const [registrations, setRegistrations] = useState([]);
  const [rawEventsMap, setEventsMap] = useState({});
  const [rawAllEvents, setRawAllEvents] = useState([]);
  const [interestedRaw, setInterestedRaw] = useState([]);
  const now = useNow(30000);

  const [dismissedNotifs, setDismissedNotifs] = useState(new Set());
  const [calendarSelectedEvent, setCalendarSelectedEvent] = useState(null);
  
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
  const [resubQrUrl, setResubQrUrl] = useState(null);
  const [generatingResubQR, setGeneratingResubQR] = useState(false);
  const [resubSaving, setResubSaving] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

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

  const openResubmit = (reg) => {
    setResubForm({
      method: (reg.payment_method || "").toLowerCase() === "online" ? "online" : "cash",
      reference: reg.payment_reference || "",
    });
    setResubProof([]);
    setResubQrUrl(null);
    setResubmitReg(reg);
  };

  const handleGenerateResubQR = async () => {
    const event = eventsMap[resubmitReg.event_id];
    setGeneratingResubQR(true);
    try {
      const res = await fetch("/api/create-qrph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: event.fee_amount, description: event.event_name }),
      });
      const data = await res.json();
      if (data.success) {
        setResubQrUrl(data.qrImageUrl);
      } else {
        notify("Failed to generate QR code: " + data.error);
      }
    } catch (e) {
      notify("Error: " + e.message);
    }
    setGeneratingResubQR(false);
  };

  const handleResubmit = async () => {
    const reg = resubmitReg;
    const event = eventsMap[reg.event_id] || {};
    const method = resubForm.method === "online" ? "Online" : "Cash";

    if (event.is_paid && method === "Online" && !resubForm.reference.trim() && resubProof.length === 0 && !reg.payment_proof_url) {
      return notify("For online payments, please enter your payment reference number or attach a screenshot of your receipt.");
    }
    const proofError = validateFiles(resubProof);
    if (proofError) return notify(proofError);

    setResubSaving(true);
    try {
      let proofUrl = reg.payment_proof_url || null;
      if (method === "Online" && resubProof.length > 0) {
        const [uploaded] = await uploadAttachments(resubProof, `payment-proofs/${user.id}`);
        proofUrl = uploaded.url;
      }

      const { error } = await supabase
        .from("event_registrations")
        .update({
          registration_status: "Pending",
          payment_method: method,
          payment_reference: method === "Online" ? resubForm.reference.trim() || null : null,
          payment_proof_url: method === "Online" ? proofUrl : null,
          rejection_reason: null,
        })
        .eq("id", reg.id)
        .eq("user_id", user.id);

      if (error) throw error;
      setResubmitReg(null);
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
    return norm(ev.status) !== "cancelled";
  });

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
      className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap shadow-sm text-center"
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
      <div className="daet-ui min-h-[60vh] flex items-center justify-center text-sm font-semibold text-gray-400">
        Loading tourist portal...
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
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">My Registered Events</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Manage and view the status of events you are participating in.</p>
              </div>
              <Link href="/programs">
                <button className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-all shadow-sm">
                  Browse More Events →
                </button>
              </Link>
            </div>

            {visibleRegistrations.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center space-y-3 shadow-sm">
                <p className="text-gray-400 text-xs font-bold uppercase">You haven't registered for any active events yet.</p>
                <Link href="/programs">
                  <button className="px-4 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all shadow-sm">
                    Find an event to join
                  </button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {visibleRegistrations.map((reg) => {
                  const event = eventsMap[reg.event_id] || {};
                  const st = regState(reg);
                  const resolvedImg = getImageUrl(event.image_url);
                  const startDateVal = event.event_date || event.date;
                  const endDateVal = event.event_end_date || event.end_date;
                  return (
                    <div key={reg.id} className="bg-white p-5 rounded-2xl border border-gray-200 flex flex-col md:flex-row gap-5 shadow-sm">
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
                        <div className={`${EVENT_THUMB} flex items-center justify-center text-gray-400 text-[10px] font-bold uppercase`}>
                          No Photo
                        </div>
                      )}

                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-black text-base text-slate-900">{event.event_name || "Municipal Event"}</h3>
                          <span
                            className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${
                              st === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : st === "rejected"
                                ? "bg-red-100 text-red-700"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {st === "pending" ? "Pending approval" : st === "rejected" ? "Rejected" : "Registered"}
                          </span>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${phaseBadge[getPhase(event.status)]}`}>
                            {getPhase(event.status) === "Ongoing" ? "Happening now" : getPhase(event.status)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{event.description || "No event description provided."}</p>
                        <div className="text-xs font-semibold text-gray-500 space-y-0.5 bg-gray-50 p-3 rounded-xl border border-gray-100">
                          <p><strong>Organizer:</strong> {event.organizer_name || "Municipal Tourism Office"}</p>
                          <p><strong>Venue:</strong> {event.venue || "TBA"}</p>
                          <p>
                            <strong>Date & Time:</strong> {formatDate(startDateVal)}
                            {endDateVal && endDateVal !== startDateVal ? ` – ${formatDate(endDateVal)}` : ""} | {formatTimeRange(event) || "TBA"}
                          </p>
                          {reg.team_name && (
                            <p><strong>Team:</strong> {reg.team_name} ({teamMembersOf(reg).length} members)</p>
                          )}
                          {event.is_paid && <p><strong>Fee:</strong> {peso(event.fee_amount)}{regTypeOf(event) === "group" ? " per team" : ""}</p>}
                        </div>

                        {event.is_paid && (
                          <div
                            className={`rounded-xl border p-3 text-xs space-y-1.5 ${
                              st === "pending"
                                ? "bg-amber-50 border-amber-200 text-amber-900"
                                : st === "rejected"
                                ? "bg-red-50 border-red-200 text-red-800"
                                : "bg-emerald-50 border-emerald-200 text-emerald-900"
                            }`}
                          >
                            <p className="text-[10px] font-black uppercase tracking-wider">
                              {st === "pending"
                                ? "Waiting for the organizer to confirm your payment"
                                : st === "rejected"
                                ? "Your registration was rejected"
                                : "Payment confirmed by the organizer"}
                            </p>
                            <p className="font-semibold">
                              Payment method: {reg.payment_method || "N/A"}
                              {reg.payment_reference ? ` | Ref: ${reg.payment_reference}` : ""}
                            </p>

                            {st === "pending" && (
                              <p className="font-medium whitespace-pre-line">
                                {(reg.payment_method || "").toLowerCase() === "online"
                                  ? `Send your payment to: ${event.online_payment_details || "ask the organizer for payment details."}`
                                  : `Pay your cash at: ${event.cash_payment_details || "ask the organizer where to pay."}`}
                              </p>
                            )}
                            {st === "pending" && (
                              <p className="font-medium">
                                You will be notified once the organizer approves your registration. Until then you are not on the official attendee list.
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

                      <div className="flex flex-col justify-center items-stretch gap-2.5 min-w-[180px]">
                        {getPhase(event.status) === "Completed" ? (
                          <span className="w-full py-2.5 bg-gray-100 text-gray-500 text-xs font-bold rounded-xl uppercase text-center shadow-sm">
                            Event completed
                          </span>
                        ) : (
                          <>
                            {st === "rejected" && (
                              <button
                                onClick={() => openResubmit(reg)}
                                className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                              >
                                Resubmit Registration
                              </button>
                            )}
                            <button
                              onClick={() => handleCancelRegistration(reg.id)}
                              className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
                            >
                              Cancel Registration
                            </button>
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
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Interested Events</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Events you starred on the public schedule. You get a reminder here one day before they start.
                </p>
              </div>
              <BackButton />
            </div>

            {upcomingInterested.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center space-y-3 shadow-sm">
                <p className="text-gray-400 text-xs font-bold uppercase">You haven't marked any upcoming events as interested.</p>
                <Link href="/programs">
                  <button className="px-4 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all shadow-sm">
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
                  return (
                    <div key={ev.id} className="bg-white p-5 rounded-2xl border border-gray-200 flex flex-col md:flex-row gap-5 shadow-sm">
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
                        <div className={`${EVENT_THUMB} flex items-center justify-center text-gray-400 text-[10px] font-bold uppercase`}>No Photo</div>
                      )}
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-black text-base text-slate-900">{ev.event_name}</h3>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${phaseBadge[getPhase(ev.status)]}`}>
                            {getPhase(ev.status) === "Ongoing" ? "Happening now" : getPhase(ev.status)}
                          </span>
                          <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-800">{startsLabel(ev)}</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">{ev.description || "No event description provided."}</p>
                        <div className="text-xs font-semibold text-gray-500 space-y-0.5 bg-gray-50 p-3 rounded-xl border border-gray-100">
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
                          <button className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center">
                            {regTypeOf(ev) === "interested" ? "View event" : "View & join"}
                          </button>
                        </Link>
                        <button
                          onClick={() => removeInterest(ev.id)}
                          className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold rounded-xl uppercase transition-all shadow-sm text-center"
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
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Official Event Calendar</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Explore the 1-year municipal event schedule across Daet and inspect same-day activities.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <BackButton />
                <Link href="/programs">
                  <button className="px-4 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs transition-all whitespace-nowrap shadow-sm">
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
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Notifications & Event Alerts</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Real-time status updates for your registered municipal activities.</p>
              </div>
              <BackButton />
            </div>

            {reminders.filter((ev) => !dismissedNotifs.has(`reminder-${ev.id}`)).length > 0 && (
              <div className="space-y-3">
                {reminders
                  .filter((ev) => !dismissedNotifs.has(`reminder-${ev.id}`))
                  .map((ev) => (
                    <div key={`reminder-${ev.id}`} className="bg-amber-50 p-5 rounded-2xl border border-amber-200 shadow-sm relative flex gap-3 items-start">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Reminder - event you are interested in</span>
                          <span className="text-[10px] text-amber-700 font-bold uppercase">{startsLabel(ev)}</span>
                        </div>
                        <p className="text-xs font-bold text-slate-900">
                          <span className="text-blue-900">{ev.event_name}</span>{" "}
                          {getPhase(ev.status) === "Ongoing" ? "is happening now." : "starts within the next day."}
                        </p>
                        <p className="text-[11px] text-gray-600">
                          Location: {ev.venue || "TBA"} | {formatDate(ev.event_date || ev.date)}
                          {formatTime(ev.event_time) ? ` at ${formatTime(ev.event_time)}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => dismissNotification(`reminder-${ev.id}`)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1 flex-shrink-0"
                        aria-label="Dismiss notification"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                  ))}
              </div>
            )}

            {totalActiveNotifications === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase shadow-sm">
                No active notifications or updates available.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRegistrations
                  .filter((reg) => !dismissedNotifs.has(`reg-notif-${reg.id}`))
                  .map((reg) => {
                    const event = eventsMap[reg.event_id] || {};
                    const phase = getPhase(event.status);
                    const st = regState(reg);
                    return (
                      <div key={reg.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm relative flex gap-3 items-start">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-blue-900 uppercase tracking-wider">
                              {st === "pending" ? "Awaiting Approval" : st === "rejected" ? "Registration Rejected" : phase === "Upcoming" ? "Registration Notice" : "Event Update"}
                            </span>
                            <span className="text-[10px] text-gray-400 font-semibold">{new Date(reg.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-900">
                            <span className="text-blue-900">{event.event_name || "Municipal Program"}</span>{" "}
                            {st === "pending"
                              ? "registration is pending. The organizer is checking your payment."
                              : st === "rejected"
                              ? "registration was rejected. Please resubmit it from My Events."
                              : phase === "Ongoing"
                              ? "is happening now. Enjoy the event!"
                              : phase === "Completed"
                              ? "has been completed. Thank you for taking part."
                              : "registration is confirmed. You are on the official attendee list."}
                          </p>
                          {st === "rejected" && reg.rejection_reason && (
                            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 mt-1">
                              <strong>Organizer note:</strong> {reg.rejection_reason}
                            </p>
                          )}
                          <p className="text-[11px] text-gray-500">
                            Location: {event.venue || "TBA"} | Scheduled Date: {formatDate(event.event_date || event.date)}
                          </p>
                        </div>
                        <button
                          onClick={() => dismissNotification(`reg-notif-${reg.id}`)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1 flex-shrink-0"
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
            <div className="w-full max-w-xl bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden space-y-6">
              <div className="flex items-center gap-4 p-6 border-b border-gray-100 bg-gradient-to-r from-blue-900 to-indigo-900 text-white">
                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-xl font-black flex-shrink-0">
                  {(profile?.full_name || user?.email || "T").trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-black truncate">{profile?.full_name || "Tourist Account"}</p>
                  <p className="text-xs text-blue-200 truncate">{user?.email}</p>
                </div>
              </div>

              <div className="px-6 pb-6">
                <dl className="divide-y divide-gray-100 text-xs">
                  {accountRows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-3 gap-4 py-3.5">
                      <dt className="font-bold text-gray-500">{label}</dt>
                      <dd className="col-span-2 font-semibold text-slate-800 break-words">
                        {value !== undefined && value !== null && value !== "" ? String(value) : <span className="text-gray-300">Not provided</span>}
                      </dd>
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-4 py-3.5">
                    <dt className="font-bold text-gray-500">Active registrations</dt>
                    <dd className="col-span-2 font-semibold text-slate-800">{visibleRegistrations.length}</dd>
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
            <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-gray-200 shadow-xl space-y-6 text-xs font-semibold">
              <div className="text-center border-b border-gray-100 pb-4 relative">
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Account Settings</h1>
                <p className="text-[11px] text-gray-500 font-semibold mt-1 uppercase tracking-widest">Update password and security</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1.5 font-bold uppercase tracking-wider text-center">ACCOUNT EMAIL</label>
                  <input type="email" disabled value={newEmail} className="w-full p-3.5 bg-gray-100 border border-gray-200 rounded-xl font-bold text-slate-700 text-center cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1.5 font-bold uppercase tracking-wider text-center">NEW PASSWORD</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-center transition-all"
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
                  className="w-full py-3.5 mt-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-wider shadow-md hover:shadow-lg transition-all"
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
        const alreadyRegistered = registrations.some((r) => String(r.event_id) === String(calendarSelectedEvent.id));
        const alreadyInterested = interestedEvents.some((ev) => String(ev.id) === String(calendarSelectedEvent.id));

        return (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={() => setCalendarSelectedEvent(null)}
          >
            <div
              className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto text-xs font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              {img && (
                <button
                  type="button"
                  onClick={() => setViewerSrc(img)}
                  className="relative w-full aspect-[16/9] bg-slate-100 block group overflow-hidden"
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
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-full uppercase bg-slate-100 text-slate-600">
                    {REG_TYPE_LABEL[regTypeOf(calendarSelectedEvent)]}
                  </span>
                  {alreadyRegistered && (
                    <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-emerald-100 text-emerald-800">
                      Registered
                    </span>
                  )}
                  {!alreadyRegistered && alreadyInterested && (
                    <span className="px-2.5 py-1 text-[10px] font-black rounded-full uppercase bg-amber-100 text-amber-800">
                      ★ Interested
                    </span>
                  )}
                </div>

                <h3 className="text-xl font-black text-slate-900 leading-snug">{calendarSelectedEvent.event_name}</h3>

                <p className="text-gray-600 leading-relaxed whitespace-pre-line">
                  {calendarSelectedEvent.description || "No event description provided."}
                </p>

                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-1.5 text-gray-600">
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
                      className="w-full py-3 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                    >
                      {alreadyRegistered ? "Open Public Schedule" : "Go to Programs to Join →"}
                    </button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setCalendarSelectedEvent(null)}
                    className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-all"
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
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-[35px] max-w-md w-full p-8 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-xs font-semibold">
              <div>
                <span className="text-[10px] font-black text-blue-900 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                  Resubmit Registration
                </span>
                <h2 className="text-xl font-black text-gray-900 mt-2">{event.event_name || "Event"}</h2>
                {resubmitReg.rejection_reason && (
                  <p className="mt-2 text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 font-medium">
                    <strong>Organizer note:</strong> {resubmitReg.rejection_reason}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 uppercase">Registration fee</span>
                <span className="text-lg font-black text-blue-900">{peso(event.fee_amount)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "cash", label: "Cash" },
                  { value: "online", label: "Online QR Ph" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setResubForm({ ...resubForm, method: opt.value }); setResubQrUrl(null); }}
                    className={`py-3 rounded-xl border-2 font-bold transition-all text-center ${
                      resubForm.method === opt.value ? "border-blue-900 bg-white text-blue-900 shadow-sm" : "border-gray-200 bg-white text-gray-500 hover:border-blue-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {resubForm.method === "cash" ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Pay your cash here</p>
                  <p className="text-gray-800 whitespace-pre-line">
                    {event.cash_payment_details || "The organizer has not stated a cash payment location yet."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Pay via QR Ph (GCash, Maya, Banks)</p>
                    {resubQrUrl ? (
                      <div className="space-y-2">
                        <img src={resubQrUrl} alt="QR Ph Code" className="w-48 h-48 mx-auto border border-gray-200 rounded-lg p-2 bg-white" />
                        <p className="text-[10px] text-gray-500 font-medium">Scan using GCash, Maya, or any participating bank app to pay {peso(event.fee_amount)}.</p>
                      </div>
                    ) : (
                      <button type="button" onClick={handleGenerateResubQR} disabled={generatingResubQR} className="px-6 py-2.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                        {generatingResubQR ? "Generating QR Code..." : "Generate QR Ph Code"}
                      </button>
                    )}
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Alternative Online Transfer</p>
                    <p className="text-gray-800 whitespace-pre-line">
                      {event.online_payment_details || "The organizer has not provided alternative bank details yet."}
                    </p>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">PAYMENT REFERENCE NO.</label>
                    <input
                      type="text"
                      value={resubForm.reference}
                      onChange={(e) => setResubForm({ ...resubForm, reference: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">RECEIPT SCREENSHOT (OPTIONAL)</label>
                    <FilePicker files={resubProof} onChange={setResubProof} multiple={false} accept="image/*" label="Attach receipt photo" />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleResubmit}
                  disabled={resubSaving}
                  className="w-full py-3.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm text-center"
                >
                  {resubSaving ? "Submitting..." : "Resubmit"}
                </button>
                <button
                  onClick={() => setResubmitReg(null)}
                  disabled={resubSaving}
                  className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-all text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Event photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}
    </div>
  );
}