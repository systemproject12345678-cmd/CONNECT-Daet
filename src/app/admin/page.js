"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";

const norm = (v) => (v || "").toString().trim().toLowerCase();

const isImageSrc = (v) => typeof v === "string" && (v.startsWith("data:image") || v.startsWith("http"));

const formatDate = (v) => {
  if (!v) return "N/A";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};

// Same matching rules the Organizer Dashboard uses, so both dashboards always agree
// on which events belong to which organizer.
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

// Shared status-filter logic for the Event Proposals Hub
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

const EVENT_FILTERS = ["All", "Pending", "Upcoming", "Ongoing", "Completed", "Requires Changes", "Rejected", "Cancelled"];
const PROGRESS_STAGES = ["Upcoming", "Ongoing", "Completed"];

const statusBadgeClass = (status) => {
  switch (norm(status)) {
    case "approved":
    case "upcoming":
    case "ongoing":
      return "bg-blue-100 text-blue-800";
    case "completed":
      return "bg-gray-200 text-gray-700";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "requires changes":
      return "bg-indigo-100 text-indigo-800";
    case "cancelled":
      return "bg-slate-200 text-slate-700";
    case "cancellation requested":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
};

export default function UnifiedAdminDashboard() {
  const router = useRouter();
  const { notify, confirm: askConfirm, feedbackUI } = useFeedback();
  const [pwSaved, setPwSaved] = useState(false);

  // Active Sidebar View Tab ('overview' | 'organizer-approvals' | 'event-approvals' | 'cancellation-requests' | 'user-management' | 'admin-settings')
  const [activeTab, setActiveTab] = useState("overview");

  // User Management Sub-Tab ('tourists' | 'organizers')
  const [userManagementSubTab, setUserManagementSubTab] = useState("tourists");

  // Data Collections
  const [organizers, setOrganizers] = useState([]);
  const [tourists, setTourists] = useState([]);
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal Dialog State for Official Feedback
  const [feedbackModal, setFeedbackModal] = useState({
    isOpen: false,
    type: "", // 'reject-organizer' | 'reject-event' | 'revision-event' | 'reject-cancellation'
    targetId: null,
    reason: "",
  });

  // Inspection & Profile Deep-Dive Modals
  const [inspectingOrganizer, setInspectingOrganizer] = useState(null);
  const [viewingProfileOrganizer, setViewingProfileOrganizer] = useState(null);

  // Admin Deep-Dive Attendees Filters
  const [adminSelectedEvent, setAdminSelectedEvent] = useState("All");
  const [adminGenderFilter, setAdminGenderFilter] = useState("All");
  const [adminAgeFilter, setAdminAgeFilter] = useState("All");

  // Account details modal for tourists / organizers: { kind: 'tourist' | 'organizer', data: profile }
  const [viewingAccount, setViewingAccount] = useState(null);

  // Full-view photo viewer + event hub status filter
  const [viewerSrc, setViewerSrc] = useState(null);
  const [eventStatusFilter, setEventStatusFilter] = useState("All");

  // Admin Account Settings
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setNewPassword] = useState("");

  // SPECIFIC ADMIN ACCOUNT CONFIGURATION
  const OFFICIAL_ADMIN_EMAIL = "admin.daet@gmail.com";

  // Fetch All Data & Verify Specific Admin Session
  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        router.push("/login");
        return;
      }

      // Check User Profile Role in Supabase Database securely
      const { data: userProfile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      // Enforce strict administrative block for trial/organizer accounts
      if (profileError || (userProfile?.role !== "admin" && session.user.email.toLowerCase() !== OFFICIAL_ADMIN_EMAIL.toLowerCase())) {
        alert("Access Denied: This portal is restricted to official system administrators only.");
        router.push("/organizer/dashboard");
        return;
      }

      setAdminEmail(session.user.email || "");

      // Fetch Profiles / Users
      const { data: profilesData, error: profilesErr } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (profilesErr) console.warn("Profiles fetch warning:", profilesErr.message);
      
      const allProfiles = profilesData || [];
      setOrganizers(allProfiles.filter((p) => p.role === "organizer"));
      setTourists(allProfiles.filter((p) => p.role === "tourist" || !p.role));

      // Fetch Events
      const { data: eventsData, error: eventsErr } = await supabase
        .from("tourism_programs")
        .select("*")
        .order("created_at", { ascending: false });

      if (eventsErr) throw eventsErr;
      setEvents(eventsData || []);

      // Fetch Event Registrations / Attendees
      const { data: regData, error: regErr } = await supabase
        .from("event_registrations")
        .select("*")
        .order("created_at", { ascending: false });

      if (regErr) console.warn("Registrations fetch warning:", regErr.message);
      setRegistrations(regData || []);
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Keep the admin view in sync with organizer / tourist activity
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
  }, []);

  const openOrganizerDeepDive = (org) => {
    setAdminSelectedEvent("All");
    setAdminGenderFilter("All");
    setAdminAgeFilter("All");
    setViewingProfileOrganizer(org);
  };

  // --- ORGANIZER ACTIONS ---
  const handleApproveOrganizer = async (id) => {
    const ok = await askConfirm({
      title: "Approve this organizer?",
      message: "The account will be verified and allowed to post events and manage attendees.",
      confirmLabel: "Approve organizer",
    });
    if (!ok) return;

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
    }
  };

  const handleRejectOrganizer = async () => {
    if (!feedbackModal.reason.trim()) return notify("Please provide an official rejection reason.");

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
    }
  };

  const handleToggleUserSuspension = async (userId, currentSuspendedState) => {
    const action = currentSuspendedState ? "reactivate" : "suspend";
    const ok = await askConfirm({
      title: currentSuspendedState ? "Reactivate this account?" : "Suspend this account?",
      message: currentSuspendedState
        ? "The user will be able to log in and use the system again."
        : "The user will be blocked from using their account until you reactivate it.",
      confirmLabel: currentSuspendedState ? "Reactivate" : "Suspend account",
      tone: currentSuspendedState ? "primary" : "danger",
    });
    if (!ok) return;

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
    }
  };

  // --- EVENT ACTIONS ---
  const updateEventStatus = async (id, newStatus) => {
    try {
      const updatePayload = { status: newStatus };
      if (newStatus === "Approved") {
        updatePayload.rejection_reason = null; // Clear cancellation flags on approval reset
      }

      const { error } = await supabase
        .from("tourism_programs")
        .update(updatePayload)
        .eq("id", id);

      if (error) throw error;
      // Update the screen immediately; the realtime refresh keeps every other dashboard in sync
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...updatePayload } : e)));
      await fetchData(true);
    } catch (err) {
      console.error("Update event error:", err);
      notify("Error updating event status: " + err.message);
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

  // Summary Metrics Calculation
  const totalOrganizersCount = organizers.length;
  const pendingOrganizersCount = organizers.filter((o) => o.status === "Pending" || !o.status).length;
  const verifiedOrganizersCount = organizers.filter((o) => o.status === "Approved").length;

  const totalEventsCount = events.length;
  const cancellationRequestsList = events.filter((e) => e.status?.toLowerCase() === "cancellation requested");
  const pendingEventsCount = events.filter((e) => e.status === "Pending" || e.status === "Under Review" || e.status === "Cancellation Requested").length;
  const activeEventsCount = events.filter((e) => e.status === "Approved" || e.status === "Upcoming" || e.status === "Ongoing").length;

  const totalPendingApprovals = pendingOrganizersCount + pendingEventsCount;
  const totalTouristsCount = tourists.length;

  // Organizer Deep-Dive Events & Attendee Filter Calculations for Admin View
  // (always read the freshest copy of the organizer after a background refresh)
  const liveOrganizer = viewingProfileOrganizer
    ? organizers.find((o) => o.id === viewingProfileOrganizer.id) || viewingProfileOrganizer
    : null;

  const organizerEvents = liveOrganizer ? events.filter((e) => eventBelongsToOrganizer(e, liveOrganizer)) : [];

  const organizerEventIds = organizerEvents.map((e) => String(e.id));
  const organizerAttendees = registrations.filter((r) => organizerEventIds.includes(String(r.event_id)));

  const filteredDeepDiveAttendees = organizerAttendees.filter((a) => {
    if (adminSelectedEvent !== "All" && String(a.event_id) !== String(adminSelectedEvent)) return false;
    if (adminGenderFilter !== "All" && a.gender?.toLowerCase() !== adminGenderFilter.toLowerCase()) return false;

    const age = parseInt(a.age, 10) || 0;
    if (adminAgeFilter === "Youth (1-17)" && age >= 18) return false;
    if (adminAgeFilter === "Adult (18-59)" && (age < 18 || age > 59)) return false;
    if (adminAgeFilter === "Senior (60+)" && age < 60) return false;

    return true;
  });

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row text-gray-800">
      {/* --- FORMAL SIDEBAR NAVIGATION --- */}
      <aside className="w-full md:w-72 bg-slate-900 text-white flex-shrink-0 shadow-xl">
        <div className="md:sticky md:top-0 md:max-h-screen md:overflow-y-auto p-5 flex flex-col gap-4">
        <div className="space-y-4">
          <div className="border-b border-slate-800 pb-4">
            <span className="px-3 py-1 bg-blue-600/30 text-blue-300 text-[10px] font-bold rounded-full uppercase tracking-wider">
              Municipal Tourism Office
            </span>
            <h2 className="text-xl font-black italic uppercase text-white mt-2">
              CONNECT-Daet Admin
            </h2>
            <p className="text-[11px] text-slate-400 font-medium">Control Center Portal</p>
          </div>

          <nav className="space-y-1 text-xs font-bold uppercase tracking-wider">
            <button
              onClick={() => setActiveTab("overview")}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all ${
                activeTab === "overview" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Dashboard Overview
            </button>
            <button
              onClick={() => setActiveTab("organizer-approvals")}
              className={`w-full text-left px-4 py-3 rounded-xl transition-all flex justify-between items-center ${
                activeTab === "organizer-approvals" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              <span>Organizer Verifications</span>
              {pendingOrganizersCount > 0 && (
                <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black text-[9px] rounded-full">
                  {pendingOrganizersCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("event-approvals")}
              className={`w-full text-left px-4 py-3 rounded-xl transition-all flex justify-between items-center ${
                activeTab === "event-approvals" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              <span>Event Proposals Hub</span>
              {pendingEventsCount > 0 && (
                <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black text-[9px] rounded-full">
                  {pendingEventsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("cancellation-requests")}
              className={`w-full text-left px-4 py-3 rounded-xl transition-all flex justify-between items-center ${
                activeTab === "cancellation-requests" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              <span>Cancellation Requests</span>
              {cancellationRequestsList.length > 0 && (
                <span className="px-2 py-0.5 bg-red-500 text-white font-black text-[9px] rounded-full">
                  {cancellationRequestsList.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("user-management")}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all ${
                activeTab === "user-management" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              User Management
            </button>
            <button
              onClick={() => setActiveTab("admin-settings")}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all ${
                activeTab === "admin-settings" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Admin Profile & Settings
            </button>
          </nav>
        </div>

        {/* Actions sit directly under the navigation so they are visible without scrolling */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <Link href="/programs" className="block">
            <button className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all text-center shadow-sm">
              View Public Gateway &rarr;
            </button>
          </Link>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push("/login");
            }}
            className="w-full py-2.5 bg-slate-800 hover:bg-red-950 text-red-400 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            Log Out
          </button>
        </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT WINDOW --- */}
      <main className="flex-1 p-6 md:p-10 space-y-8 min-w-0">
        {loading && (
          <div className="text-center py-16 text-gray-400 text-xs font-bold uppercase tracking-widest">
            Synchronizing database records...
          </div>
        )}

        {/* VIEW 1: DASHBOARD OVERVIEW */}
        {!loading && activeTab === "overview" && (
          <div className="space-y-8">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  System Overview Dashboard
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Real-time portal metrics across Daet Municipal Tourism Operations
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setActiveTab("organizer-approvals")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                  Review Organizers ({pendingOrganizersCount})
                </button>
                <button onClick={() => setActiveTab("event-approvals")} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all">
                  Review Events ({pendingEventsCount})
                </button>
              </div>
            </div>

            {/* Overview Metric Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  Total Organizers
                </span>
                <p className="text-3xl font-black text-slate-900">{totalOrganizersCount}</p>
                <div className="text-[11px] font-semibold text-gray-500 flex justify-between pt-2 border-t border-gray-100">
                  <span>Verified: <strong className="text-emerald-700">{verifiedOrganizersCount}</strong></span>
                  <span>Pending: <strong className="text-amber-600">{pendingOrganizersCount}</strong></span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-amber-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider">
                  Pending Approvals
                </span>
                <p className="text-3xl font-black text-amber-700">{totalPendingApprovals}</p>
                <div className="text-[11px] font-semibold text-gray-500 flex justify-between pt-2 border-t border-amber-100">
                  <span>Accounts: <strong className="text-amber-800">{pendingOrganizersCount}</strong></span>
                  <span>Events: <strong className="text-amber-800">{pendingEventsCount}</strong></span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  Total Events
                </span>
                <p className="text-3xl font-black text-blue-900">{totalEventsCount}</p>
                <div className="text-[11px] font-semibold text-gray-500 pt-2 border-t border-gray-100">
                  Active / Published: <strong className="text-emerald-700">{activeEventsCount}</strong>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  System Users / Tourist
                </span>
                <p className="text-3xl font-black text-slate-900">{totalTouristsCount}</p>
                <div className="text-[11px] font-semibold text-gray-500 pt-2 border-t border-gray-100">
                  Registered Tourists
                </div>
              </div>
            </div>

            {/* Quick Attention Queues */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-sm uppercase">Pending Organizer Applications</h3>
                  <button onClick={() => setActiveTab("organizer-approvals")} className="text-xs text-blue-700 font-bold hover:underline">
                    View All &rarr;
                  </button>
                </div>
                {pendingOrganizersCount === 0 ? (
                  <p className="text-xs text-gray-400 font-semibold py-4 text-center">No pending organizer account applications.</p>
                ) : (
                  <div className="space-y-3">
                    {organizers.filter((o) => o.status === "Pending" || !o.status).slice(0, 3).map((org) => (
                      <div key={org.id} className="p-3.5 bg-gray-50 rounded-xl flex justify-between items-center text-xs">
                        <div>
                          <p className="font-bold text-slate-900">{org.organization || org.full_name}</p>
                          <p className="text-[10px] text-gray-500">{org.email}</p>
                        </div>
                        <button
                          onClick={() => setInspectingOrganizer(org)}
                          className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[10px] font-bold uppercase"
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
                  <button onClick={() => setActiveTab("event-approvals")} className="text-xs text-blue-700 font-bold hover:underline">
                    View All &rarr;
                  </button>
                </div>
                {pendingEventsCount === 0 ? (
                  <p className="text-xs text-gray-400 font-semibold py-4 text-center">No event proposals awaiting review.</p>
                ) : (
                  <div className="space-y-3">
                    {events.filter((e) => e.status === "Pending" || e.status === "Under Review" || e.status === "Cancellation Requested").slice(0, 3).map((event) => (
                      <div key={event.id} className="p-3.5 bg-gray-50 rounded-xl flex justify-between items-center text-xs">
                        <div>
                          <p className="font-bold text-slate-900">{event.event_name}</p>
                          <p className="text-[10px] text-gray-500">Status: {event.status}</p>
                        </div>
                        <button
                          onClick={() => updateEventStatus(event.id, "Approved")}
                          className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[10px] font-bold uppercase"
                        >
                          Approve
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: ORGANIZER APPROVALS & VERIFICATIONS */}
        {!loading && activeTab === "organizer-approvals" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Organizer Approvals & Verifications
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Inspect organizer accounts, valid ID, logo, BIR TIN photo, DTI/SEC photo, and business permit photo.
                </p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                &larr; Back to Overview
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
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
                  {organizers.map((org) => (
                    <tr key={org.id}>
                      <td className="p-4 flex items-center gap-3">
                        {org.logo_url && <img src={org.logo_url} alt="Logo" className="w-10 h-10 object-cover rounded-lg border" />}
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
                      <td className="p-4 text-right space-x-2">
                        <button
                          onClick={() => setInspectingOrganizer(org)}
                          className="px-3 py-1.5 bg-slate-800 text-white rounded-lg font-bold text-[10px] uppercase hover:bg-slate-700 transition-all"
                        >
                          Inspect Documents
                        </button>
                        {org.status === "Approved" && (
                          <button
                            onClick={() => openOrganizerDeepDive(org)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] uppercase transition-all"
                          >
                            View Profile & Events
                          </button>
                        )}
                        {org.status !== "Rejected" && (
                          <button
                            onClick={() => setFeedbackModal({ isOpen: true, type: "reject-organizer", targetId: org.id, reason: "" })}
                            className="px-3 py-1.5 bg-gray-200 hover:bg-red-800 hover:text-white text-gray-700 rounded-lg font-bold text-[10px] uppercase transition-all"
                          >
                            Reject
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 3: EVENT PROPOSALS HUB */}
        {!loading && activeTab === "event-approvals" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Event Proposals Management Hub
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Evaluate event details, manage compliance, and handle event proposals.
                </p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all whitespace-nowrap">
                &larr; Back to Overview
              </button>
            </div>

            {/* Status filter */}
            <div className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-2xl border border-gray-200 w-fit max-w-full">
              {EVENT_FILTERS.map((f) => {
                const count = events.filter((e) => matchesEventFilter(e, f)).length;
                return (
                  <button
                    key={f}
                    onClick={() => setEventStatusFilter(f)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      eventStatusFilter === f ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {f} <span className={eventStatusFilter === f ? "text-blue-100" : "text-gray-400"}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {events
                .filter((e) => matchesEventFilter(e, eventStatusFilter))
                .map((event) => {
                  const st = norm(event.status);
                  const isCancelled = st === "cancelled";
                  const isApproved = st === "approved" || st === "upcoming" || st === "ongoing" || st === "completed";
                  const eventRegCount = registrations.filter((r) => String(r.event_id) === String(event.id)).length;

                  return (
                    <div key={event.id} className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col md:flex-row justify-between gap-5 shadow-sm">
                      {event.image_url && (
                        <button
                          type="button"
                          onClick={() => setViewerSrc(event.image_url)}
                          className="relative w-full md:w-48 h-40 md:h-auto flex-shrink-0 rounded-xl overflow-hidden bg-slate-100 group"
                          aria-label={`View full photo of ${event.event_name}`}
                        >
                          <img src={event.image_url} alt={event.event_name} className="w-full h-full object-cover" />
                          <span className="absolute bottom-2 right-2 px-2.5 py-1 bg-black/60 text-white text-[10px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                            View full photo
                          </span>
                        </button>
                      )}

                      <div className="space-y-3 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-black text-slate-900 text-base">{event.event_name}</h3>
                          <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase ${statusBadgeClass(event.status)}`}>
                            {event.status || "Pending"}
                          </span>
                        </div>

                        <p className="text-xs text-gray-600 leading-relaxed">{event.description || "No description provided."}</p>

                        <div className="text-xs text-gray-500 font-semibold space-y-1 bg-gray-50 p-3 rounded-xl">
                          <p><strong>Organizer:</strong> {event.organizer_name || "N/A"}</p>
                          <p><strong>Venue Location:</strong> {event.venue || "TBA"}</p>
                          <p><strong>Proposed Date:</strong> {event.event_date || "TBA"}</p>
                          <p><strong>Registered participants:</strong> {eventRegCount}</p>
                          {event.rejection_reason && <p className="text-red-600"><strong>Rejection Reason:</strong> {event.rejection_reason}</p>}
                          {event.revision_notes && <p className="text-indigo-700"><strong>Requires Changes Notes:</strong> {event.revision_notes}</p>}
                        </div>

                        {/* Lifecycle control: updates the guest page, tourist and organizer dashboards */}
                        {isApproved && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Event progress</p>
                            <div className="inline-flex gap-1 bg-gray-100 p-1 rounded-xl">
                              {PROGRESS_STAGES.map((stage) => {
                                const current = st === "approved" ? "upcoming" : st;
                                const active = current === norm(stage);
                                return (
                                  <button
                                    key={stage}
                                    onClick={() => !active && updateEventStatus(event.id, stage)}
                                    aria-pressed={active}
                                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                      active
                                        ? stage === "Ongoing"
                                          ? "bg-emerald-500 text-white shadow-sm"
                                          : stage === "Completed"
                                          ? "bg-slate-700 text-white shadow-sm"
                                          : "bg-blue-600 text-white shadow-sm"
                                        : "text-gray-600 hover:bg-white"
                                    }`}
                                  >
                                    {stage}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col justify-center gap-2 md:min-w-[180px]">
                        {!isCancelled && (
                          <>
                            <button
                              onClick={() => updateEventStatus(event.id, "Approved")}
                              disabled={isApproved}
                              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-100 disabled:text-blue-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs shadow-sm transition-all"
                            >
                              {isApproved ? "Approved" : "Approve Event"}
                            </button>
                            <button
                              onClick={() => setFeedbackModal({ isOpen: true, type: "revision-event", targetId: event.id, reason: "" })}
                              className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-xs transition-all"
                            >
                              Requires Changes
                            </button>
                            <button
                              onClick={() => setFeedbackModal({ isOpen: true, type: "reject-event", targetId: event.id, reason: "" })}
                              className="w-full py-2.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-xs transition-all"
                            >
                              Reject Event
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => deleteEvent(event.id)}
                          className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-bold text-xs transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}

              {events.length === 0 && (
                <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                  No event proposals have been submitted yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 4: CANCELLATION REQUESTS MANAGEMENT */}
        {!loading && activeTab === "cancellation-requests" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Event Cancellation Requests Queue
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Review reasons submitted by organizers and approve or reject event cancellations.
                </p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                &larr; Back to Overview
              </button>
            </div>

            {cancellationRequestsList.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                No active event cancellation requests pending review.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {cancellationRequestsList.map((event) => (
                  <div key={event.id} className="bg-white rounded-2xl border border-red-200 p-5 flex flex-col md:flex-row justify-between gap-5 shadow-sm">
                    {event.image_url && (
                      <button
                        type="button"
                        onClick={() => setViewerSrc(event.image_url)}
                        className="relative w-full md:w-44 h-36 md:h-auto flex-shrink-0 rounded-xl overflow-hidden bg-slate-100 group"
                        aria-label={`View full photo of ${event.event_name}`}
                      >
                        <img src={event.image_url} alt={event.event_name} className="w-full h-full object-cover" />
                        <span className="absolute bottom-2 right-2 px-2.5 py-1 bg-black/60 text-white text-[10px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                          View full photo
                        </span>
                      </button>
                    )}
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
                        <p><strong>Event Date:</strong> {event.event_date || "TBA"} | Venue: {event.venue || "TBA"}</p>
                        <p className="text-red-700 pt-1 border-t border-red-200">
                          <strong>Cancellation Reason Provided:</strong> {event.rejection_reason || "No reason stated."}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col justify-center gap-2.5 min-w-[200px]">
                      <button
                        onClick={() => handleApproveCancellation(event)}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all"
                      >
                        Approve Cancellation
                      </button>
                      <button
                        onClick={() => setFeedbackModal({ isOpen: true, type: "reject-cancellation", targetId: event.id, reason: "" })}
                        className="w-full py-2.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-xs transition-all"
                      >
                        Reject Cancellation
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 5: USER MANAGEMENT (SEPARATED TOURISTS & ORGANIZERS) */}
        {!loading && activeTab === "user-management" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  System User Management
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Manage and inspect tourist and organizer accounts.
                </p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">
                &larr; Back to Overview
              </button>
            </div>

            {/* Sub-Tab Navigation for User Separation */}
            <div className="flex gap-2 border-b border-gray-200 pb-3">
              <button
                onClick={() => setUserManagementSubTab("tourists")}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${
                  userManagementSubTab === "tourists"
                    ? "bg-slate-900 text-white shadow-md"
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                Tourist Accounts ({tourists.length})
              </button>
              <button
                onClick={() => setUserManagementSubTab("organizers")}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${
                  userManagementSubTab === "organizers"
                    ? "bg-slate-900 text-white shadow-md"
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                Organizer Accounts ({organizers.length})
              </button>
            </div>

            {/* TOURISTS TABLE */}
            {userManagementSubTab === "tourists" && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="p-4 bg-slate-50 border-b border-gray-200 font-bold text-slate-900 text-xs uppercase">
                  Registered Tourist Accounts
                </div>
                <div className="overflow-x-auto"><table className="w-full text-left text-xs">
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
                    {tourists.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="p-8 text-center text-gray-400 font-bold uppercase">No tourist accounts found.</td>
                      </tr>
                    ) : (
                      tourists.map((usr) => (
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
                          <td className="p-4 text-right space-x-2 whitespace-nowrap">
                            <button
                              onClick={() => setViewingAccount({ kind: "tourist", data: usr })}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] uppercase transition-all"
                            >
                              View Account
                            </button>
                            <button
                              onClick={() => handleToggleUserSuspension(usr.id, usr.is_suspended)}
                              className={`px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase transition-all ${
                                usr.is_suspended ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-100 hover:bg-red-200 text-red-700"
                              }`}
                            >
                              {usr.is_suspended ? "Reactivate" : "Suspend Account"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table></div>
              </div>
            )}

            {/* ORGANIZERS TABLE */}
            {userManagementSubTab === "organizers" && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="p-4 bg-slate-50 border-b border-gray-200 font-bold text-slate-900 text-xs uppercase">
                  Registered Organizer Accounts
                </div>
                <div className="overflow-x-auto"><table className="w-full text-left text-xs">
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
                    {organizers.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="p-8 text-center text-gray-400 font-bold uppercase">No organizer accounts found.</td>
                      </tr>
                    ) : (
                      organizers.map((org) => (
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
                          <td className="p-4 text-right space-x-2 whitespace-nowrap">
                            <button
                              onClick={() => setViewingAccount({ kind: "organizer", data: org })}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] uppercase transition-all"
                            >
                              View Account
                            </button>
                            <button
                              onClick={() => handleToggleUserSuspension(org.id, org.is_suspended)}
                              className={`px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase transition-all ${
                                org.is_suspended ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-100 hover:bg-red-200 text-red-700"
                              }`}
                            >
                              {org.is_suspended ? "Reactivate" : "Suspend Account"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table></div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 6: ADMIN PROFILE & SETTINGS */}
        {!loading && activeTab === "admin-settings" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Admin Profile & Security Settings
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Official Municipal Tourism Office Administrator Credentials.
                </p>
              </div>
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all whitespace-nowrap">
                &larr; Back to Overview
              </button>
            </div>
            <div className="bg-white p-8 rounded-2xl border border-gray-200 max-w-md space-y-4 text-xs font-semibold shadow-sm">
              <div>
                <label className="block text-gray-600 mb-1">OFFICIAL ADMIN EMAIL</label>
                <input type="email" disabled value={adminEmail} className="w-full p-3 bg-gray-100 rounded-xl font-bold text-slate-700" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">UPDATE PASSWORD</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={adminPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
                />
              </div>
              <button
                onClick={async () => {
                  if (!adminPassword) return notify("Please enter a new password first.");
                  const { error } = await supabase.auth.updateUser({ password: adminPassword });
                  if (error) {
                    notify("Error updating password: " + error.message);
                  } else {
                    setNewPassword("");
                    setPwSaved(true);
                    setTimeout(() => setPwSaved(false), 2000);
                  }
                }}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase shadow-sm transition-all"
              >
                {pwSaved ? "Saved \u2713" : "Save Admin Settings"}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* --- INSPECTION MODAL FOR ORGANIZER ATTACHED DOCUMENTS --- */}
      {inspectingOrganizer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-8 shadow-2xl space-y-6 text-xs font-semibold max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase">
                  Organizer Verification Documents: {inspectingOrganizer.organization}
                </h3>
                <p className="text-gray-500 font-medium">Review attached credibility credentials and photos</p>
              </div>
              <button onClick={() => setInspectingOrganizer(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold">&larr; Back</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* BIR TIN PHOTO ATTACHMENT */}
              <div>
                <p className="text-gray-600 mb-1 font-bold">BIR TIN (TAX ID) PHOTO</p>
                {inspectingOrganizer.bir_tin ? (
                  <button type="button" onClick={() => setViewerSrc(inspectingOrganizer.bir_tin)} className="block w-full" aria-label="View full BIR TIN Document">
<img src={inspectingOrganizer.bir_tin} alt="BIR TIN Document" className="w-full h-40 object-cover rounded-xl border shadow-sm hover:opacity-90" />
</button>
                ) : (
                  <div className="p-8 bg-gray-50 border rounded-xl text-center text-gray-400">No BIR TIN photo uploaded</div>
                )}
              </div>

              {/* DTI / SEC REGISTRATION PHOTO */}
              <div>
                <p className="text-gray-600 mb-1 font-bold">DTI / SEC REGISTRATION PHOTO</p>
                {inspectingOrganizer.dti_sec_reg ? (
                  <button type="button" onClick={() => setViewerSrc(inspectingOrganizer.dti_sec_reg)} className="block w-full" aria-label="View full DTI/SEC Document">
<img src={inspectingOrganizer.dti_sec_reg} alt="DTI/SEC Document" className="w-full h-40 object-cover rounded-xl border shadow-sm hover:opacity-90" />
</button>
                ) : (
                  <div className="p-8 bg-gray-50 border rounded-xl text-center text-gray-400">No DTI/SEC photo uploaded</div>
                )}
              </div>

              {/* BUSINESS PERMIT PHOTO */}
              <div>
                <p className="text-gray-600 mb-1 font-bold">BUSINESS PERMIT PHOTO</p>
                {inspectingOrganizer.business_permit_no ? (
                  <button type="button" onClick={() => setViewerSrc(inspectingOrganizer.business_permit_no)} className="block w-full" aria-label="View full Business Permit">
<img src={inspectingOrganizer.business_permit_no} alt="Business Permit" className="w-full h-40 object-cover rounded-xl border shadow-sm hover:opacity-90" />
</button>
                ) : (
                  <div className="p-8 bg-gray-50 border rounded-xl text-center text-gray-400">No Business Permit photo uploaded</div>
                )}
              </div>

              {/* REPRESENTATIVE VALID ID */}
              <div>
                <p className="text-gray-600 mb-1 font-bold">REPRESENTATIVE VALID ID</p>
                {inspectingOrganizer.valid_id_url ? (
                  <button type="button" onClick={() => setViewerSrc(inspectingOrganizer.valid_id_url)} className="block w-full" aria-label="View full Valid ID">
<img src={inspectingOrganizer.valid_id_url} alt="Valid ID" className="w-full h-40 object-cover rounded-xl border shadow-sm hover:opacity-90" />
</button>
                ) : (
                  <div className="p-8 bg-gray-50 border rounded-xl text-center text-gray-400">No Valid ID uploaded</div>
                )}
              </div>

              {/* ORGANIZATION LOGO */}
              <div className="md:col-span-2">
                <p className="text-gray-600 mb-1 font-bold">ORGANIZATION LOGO</p>
                {inspectingOrganizer.logo_url ? (
                  <button type="button" onClick={() => setViewerSrc(inspectingOrganizer.logo_url)} className="block w-full" aria-label="View full Logo">
<img src={inspectingOrganizer.logo_url} alt="Logo" className="w-full h-40 object-cover rounded-xl border shadow-sm hover:opacity-90" />
</button>
                ) : (
                  <div className="p-8 bg-gray-50 border rounded-xl text-center text-gray-400">No Logo uploaded</div>
                )}
              </div>
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
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl uppercase shadow-sm"
              >
                Approve & Verify Organizer Account
              </button>
              <button
                onClick={() => {
                  const targetId = inspectingOrganizer.id;
                  setInspectingOrganizer(null);
                  setFeedbackModal({ isOpen: true, type: "reject-organizer", targetId, reason: "" });
                }}
                className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-xl uppercase"
              >
                Reject Application
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- DEEP DIVE PROFILE & ATTENDEES INSPECTION MODAL --- */}
      {liveOrganizer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-5xl w-full p-8 shadow-2xl space-y-6 text-xs font-semibold max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase">
                  Organizer Deep-Dive: {liveOrganizer.organization || liveOrganizer.organizer_full_name || liveOrganizer.full_name}
                </h3>
                <p className="text-gray-500 font-medium">Viewing hosted events and participant records</p>
              </div>
              <button onClick={() => setViewingProfileOrganizer(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold whitespace-nowrap">&larr; Back</button>
            </div>

            {/* Hosted events */}
            <div className="space-y-3">
              <h4 className="text-xs font-black text-slate-900 uppercase">Hosted events ({organizerEvents.length})</h4>
              {organizerEvents.length === 0 ? (
                <div className="p-6 text-center text-gray-400 font-bold uppercase bg-gray-50 rounded-xl">
                  No events found for this organizer yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {organizerEvents.map((ev) => {
                    const count = registrations.filter((r) => String(r.event_id) === String(ev.id)).length;
                    return (
                      <div key={ev.id} className="flex gap-3 p-3 border border-gray-200 rounded-xl bg-white">
                        {ev.image_url ? (
                          <button
                            type="button"
                            onClick={() => setViewerSrc(ev.image_url)}
                            className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100"
                            aria-label={`View full photo of ${ev.event_name}`}
                          >
                            <img src={ev.image_url} alt={ev.event_name} className="w-full h-full object-cover hover:opacity-90" />
                          </button>
                        ) : (
                          <div className="w-20 h-20 flex-shrink-0 rounded-lg bg-slate-100" />
                        )}
                        <div className="min-w-0 space-y-1">
                          <p className="font-black text-slate-900 truncate">{ev.event_name}</p>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusBadgeClass(ev.status)}`}>
                            {ev.status || "Pending"}
                          </span>
                          <p className="text-gray-500 font-medium truncate">{ev.venue || "TBA"} &middot; {formatDate(ev.event_date || ev.date)}</p>
                          <p className="text-gray-700">{count} registered {count === 1 ? "participant" : "participants"}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap gap-4 bg-gray-50 p-4 rounded-xl items-end">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">SELECT EVENT</label>
                <select
                  value={adminSelectedEvent}
                  onChange={(e) => setAdminSelectedEvent(e.target.value)}
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
                      <th className="p-3">Participant Name</th>
                      <th className="p-3">Event</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Gender</th>
                      <th className="p-3">Age</th>
                      <th className="p-3">Address</th>
                      <th className="p-3">Registered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-gray-700">
                    {filteredDeepDiveAttendees.map((attendee) => (
                      <tr key={attendee.id}>
                        <td className="p-3 font-bold text-slate-900">{attendee.first_name} {attendee.last_name}</td>
                        <td className="p-3">{events.find((ev) => String(ev.id) === String(attendee.event_id))?.event_name || "N/A"}</td>
                        <td className="p-3">{attendee.email}<br /><span className="text-[10px] text-gray-400">{attendee.phone_number}</span></td>
                        <td className="p-3">{attendee.gender}</td>
                        <td className="p-3">{attendee.age} yrs</td>
                        <td className="p-3">{attendee.home_address}</td>
                        <td className="p-3">{attendee.created_at ? new Date(attendee.created_at).toLocaleDateString() : "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- ACCOUNT DETAILS MODAL (TOURIST / ORGANIZER) --- */}
      {viewingAccount && (() => {
        const acct = viewingAccount.data;
        const isOrg = viewingAccount.kind === "organizer";
        const acctEvents = isOrg ? events.filter((e) => eventBelongsToOrganizer(e, acct)) : [];
        const acctRegs = !isOrg ? registrations.filter((r) => r.user_id === acct.id) : [];

        const rows = isOrg
          ? [
              ["Organization", acct.organization],
              ["Representative", acct.organizer_full_name || acct.full_name],
              ["Email", acct.email],
              ["Contact number", acct.contact_number || acct.phone],
              ["Organization type", acct.org_type],
              ["Office address", acct.address],
              ["Website / social media", acct.website_link],
              ["Verification status", acct.status || "Pending"],
              ["Account state", acct.is_suspended ? "Suspended" : "Active"],
              ["Joined", acct.created_at ? formatDate(acct.created_at) : null],
              ...(acct.rejection_reason ? [["Rejection reason", acct.rejection_reason]] : []),
            ]
          : [
              ["Full name", acct.full_name],
              ["Email", acct.email],
              ["Phone number", acct.contact_number || acct.phone_number || acct.phone],
              ["Age", acct.age],
              ["Sex / gender", acct.sex || acct.gender],
              ["Civil status", acct.civil_status],
              ["Home address", acct.address || acct.home_address],
              ["Verification status", acct.status],
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
            ].filter(([, v]) => v)
          : [];

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-3xl w-full p-8 shadow-2xl space-y-6 text-xs font-semibold max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-start gap-4 border-b pb-4">
                <div>
                  <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-black rounded-full uppercase">
                    {isOrg ? "Organizer account" : "Tourist account"}
                  </span>
                  <h3 className="text-lg font-black text-slate-900 mt-2">
                    {isOrg ? acct.organization || acct.organizer_full_name || acct.full_name : acct.full_name || "Unnamed Tourist"}
                  </h3>
                </div>
                <button onClick={() => setViewingAccount(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold whitespace-nowrap">
                  &larr; Back to User Management
                </button>
              </div>

              <dl className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-4 px-4 py-3">
                    <dt className="font-bold text-gray-500">{label}</dt>
                    <dd className="col-span-2 text-slate-800 break-words">
                      {value !== undefined && value !== null && value !== "" ? String(value) : <span className="text-gray-300">Not provided</span>}
                    </dd>
                  </div>
                ))}
              </dl>

              {isOrg && docs.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-slate-900 uppercase">Submitted documents</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {docs.map(([label, value]) => (
                      <div key={label} className="space-y-1">
                        <p className="text-gray-500 font-bold">{label}</p>
                        {isImageSrc(value) ? (
                          <button type="button" onClick={() => setViewerSrc(value)} className="block w-full" aria-label={`View full ${label}`}>
                            <img src={value} alt={label} className="w-full h-28 object-cover rounded-xl border hover:opacity-90" />
                          </button>
                        ) : (
                          <p className="p-3 bg-gray-50 border rounded-xl text-slate-800 break-words">{value}</p>
                        )}
                      </div>
                    ))}
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
                          <span className="font-bold text-slate-900 truncate">{ev.event_name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusBadgeClass(ev.status)}`}>{ev.status || "Pending"}</span>
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
                            <span className="font-bold text-slate-900 truncate">{ev?.event_name || "Removed event"}</span>
                            <span className="text-gray-500">{ev?.event_date ? formatDate(ev.event_date) : "TBA"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Photo" onClose={() => setViewerSrc(null)} />}

      {/* --- FEEDBACK / REJECTION MODAL --- */}
      {feedbackModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs font-semibold">
            <h3 className="text-lg font-black text-slate-900 uppercase">
              {feedbackModal.type === "reject-organizer" ? "Reject Organizer Application" :
               feedbackModal.type === "reject-cancellation" ? "Deny Cancellation Request" : "Provide Event Revision Feedback"}
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
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
            />

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  if (feedbackModal.type === "reject-organizer") handleRejectOrganizer();
                  else handleSubmitEventFeedback();
                }}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl uppercase shadow-sm"
              >
                Submit Feedback
              </button>
              <button
                onClick={() => setFeedbackModal({ isOpen: false, type: "", targetId: null, reason: "" })}
                className="px-5 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl"
              >
                &larr; Back
              </button>
            </div>
          </div>
        </div>
      )}
      {feedbackUI}
    </div>
  );
}