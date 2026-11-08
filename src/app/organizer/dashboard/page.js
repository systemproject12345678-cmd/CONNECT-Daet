"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";

const statusBadge = (status) => {
  switch ((status || "").toLowerCase()) {
    case "approved":
    case "upcoming":
      return "bg-blue-100 text-blue-800";
    case "ongoing":
      return "bg-emerald-100 text-emerald-800";
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

export default function OrganizerDashboardPage() {
  const router = useRouter();
  const { notify, feedbackUI } = useFeedback();
  const [pwSaved, setPwSaved] = useState(false);

  // Active Sidebar View Tab ('overview' | 'my-events' | 'attendees' | 'notifications' | 'profile' | 'settings')
  const [activeTab, setActiveTab] = useState("overview");

  // User & Profile State
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Data Collections
  const [events, setEvents] = useState([]);
  const [attendees, setAttendees] = useState([]);

  // Modals State
  const [editingEvent, setEditingEvent] = useState(null);
  const [cancelingEvent, setCancelingEvent] = useState(null);
  const [cancellationReason, setCancellationReason] = useState("");

  // Per-card expanded attendees inspection state (eventId -> boolean)
  const [expandedEventId, setExpandedEventId] = useState(null);
  // Per-card filter states: { [eventId]: { gender: 'All', ageBracket: 'All' } }
  const [eventFilters, setEventFilters] = useState({});

  // Full-view photo state
  const [viewerSrc, setViewerSrc] = useState(null);

  // Account Settings Form State
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const fetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      router.push("/login");
      return;
    }

    setUser(session.user);
    setNewEmail(session.user.email || "");

    // 1. Fetch Profile & Check Role
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

    // 2. Fetch All Events and filter client-side for 100% reliability
    const { data: allEventsData, error: eventsErr } = await supabase
      .from("tourism_programs")
      .select("*")
      .order("created_at", { ascending: false });

    if (eventsErr) {
      console.error("Error fetching events:", eventsErr.message);
    }

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

    // 3. Fetch Event Registrations / Attendees
    const { data: attendeesData } = await supabase
      .from("event_registrations")
      .select("*")
      .order("created_at", { ascending: false });

    setAttendees(attendeesData || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData().then(() => {});

    // Real-time subscription to ensure attendee registrations/cancellations sync automatically
    const channel = supabase
      .channel("organizer-dashboard-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_registrations",
        },
        () => {
          fetchData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tourism_programs",
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    // Refresh when the organizer returns to this tab (e.g. after the admin reviewed an event)
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

  // --- RESTRICTED EDIT EVENT ACTION (Picture, Description, Time ONLY) ---
  const handleSaveEventEdit = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from("tourism_programs")
        .update({
          image_url: editingEvent.image_url,
          description: editingEvent.description,
          event_time: editingEvent.event_time,
          status: "Pending", // Resubmit for review when edited
        })
        .eq("id", editingEvent.id);

      if (error) throw error;
      setEditingEvent(null);
      await fetchData();
    } catch (err) {
      notify("Error updating event: " + err.message);
    }
  };

  // --- CANCEL EVENT REQUEST WITH ADMIN NOTIFICATION ---
  const handleRequestCancellation = async (e) => {
    e.preventDefault();
    if (!cancellationReason.trim()) return notify("Please provide a detailed reason for cancellation.");

    try {
      const { error } = await supabase
        .from("tourism_programs")
        .update({
          status: "Cancellation Requested",
          rejection_reason: cancellationReason.trim(), // shown to the admin in Cancellation Requests
        })
        .eq("id", cancelingEvent.id);

      if (error) throw error;

      setCancelingEvent(null);
      setCancellationReason("");
      await fetchData();
    } catch (err) {
      notify("Error submitting cancellation request: " + err.message);
    }
  };

  // Status Metrics Calculation Logic
  const totalEvents = events.length;
  // Events that are live on the public schedule (approved, upcoming or ongoing)
  const activeEventsList = events.filter((e) =>
    ["approved", "upcoming", "ongoing"].includes((e.status || "").toLowerCase())
  );
  // Attendee lists stay available for completed events too
  const approvedEventsList = events.filter((e) =>
    ["approved", "upcoming", "ongoing", "completed"].includes((e.status || "").toLowerCase())
  );
  const approvedEvents = activeEventsList.length;
  const rejectedEvents = events.filter((e) => e.status?.toLowerCase() === "rejected").length;
  const completedEvents = events.filter((e) => e.status?.toLowerCase() === "completed").length;
  const underReviewEvents = events.filter(
    (e) => e.status?.toLowerCase() === "pending" || e.status?.toLowerCase() === "under review"
  ).length;
  const requiresChangesEvents = events.filter((e) => e.status?.toLowerCase() === "requires changes").length;
  const pendingForApproval = events.filter((e) => e.status?.toLowerCase() === "pending").length;

  // Filter Attendees strictly for Approved Events
  const approvedEventIds = approvedEventsList.map((e) => e.id);
  const approvedAttendees = attendees.filter((a) => approvedEventIds.includes(a.event_id));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-xs font-bold uppercase tracking-widest text-gray-400">
        Authenticating organizer credentials...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row text-gray-800">
      {/* --- FORMAL SIDEBAR NAVIGATION (PINNED & COMPACTED TO FIT VIEWPORT) --- */}
      <aside className="w-full md:w-72 bg-slate-900 text-white flex-shrink-0 shadow-xl">
        <div className="md:sticky md:top-0 md:max-h-screen md:overflow-y-auto p-5 flex flex-col gap-4">
        <div className="space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <span className="px-2.5 py-0.5 bg-blue-600/30 text-blue-300 text-[9px] font-bold rounded-full uppercase tracking-wider">
              Organizer Control Center
            </span>
            <h2 className="text-base font-black italic uppercase text-white mt-1.5 leading-tight truncate">
              {profile?.organization || "Event Organizer"}
            </h2>
            <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">
              Host: {profile?.organizer_full_name || profile?.full_name}
            </p>
          </div>

          <nav className="space-y-1 text-xs font-bold uppercase tracking-wider">
            <button
              onClick={() => setActiveTab("overview")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === "overview" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Dashboard Overview
            </button>
            <button
              onClick={() => setActiveTab("my-events")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === "my-events" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              My Events
            </button>
            <button
              onClick={() => setActiveTab("attendees")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === "attendees" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Attendees / Registrations
            </button>
            <button
              onClick={() => setActiveTab("notifications")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === "notifications" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Notifications
            </button>
            <button
              onClick={() => setActiveTab("profile")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === "profile" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Organizer Profile
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === "settings" ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Account Settings
            </button>
          </nav>
        </div>

        {/* Bottom Actions Accessible Immediately Without Scrolling */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <Link href="/programs/submit" className="block">
            <button className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all text-center shadow-sm uppercase tracking-wider">
              + Post New Event &rarr;
            </button>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full py-2 bg-slate-800 hover:bg-red-950 text-red-400 rounded-xl text-xs font-bold transition-all shadow-sm uppercase tracking-wider"
          >
            Log Out
          </button>
        </div>
        </div>
      </aside>

      {/* --- MAIN DASHBOARD CONTENT WINDOW --- */}
      <main className="flex-1 p-6 md:p-10 space-y-8 min-w-0">
        {/* VIEW 1: OVERVIEW METRICS */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row justify-between md:items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Dashboard Overview</h1>
                <p className="text-xs font-semibold text-gray-500 mt-0.5">Live operational metrics and event proposal status tracker</p>
              </div>
              <Link href="/programs/submit">
                <button className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all">
                  Submit Event Proposal &rarr;
                </button>
              </Link>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Total Submitted</span>
                <p className="text-3xl font-black text-slate-900">{totalEvents}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Approved / Active</span>
                <p className="text-3xl font-black text-emerald-700">{approvedEvents}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Under Review</span>
                <p className="text-3xl font-black text-amber-700">{underReviewEvents}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-purple-700 uppercase tracking-wider">Requires Changes</span>
                <p className="text-3xl font-black text-purple-700">{requiresChangesEvents}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Completed</span>
                <p className="text-3xl font-black text-slate-900">{completedEvents}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-red-700 uppercase tracking-wider">Rejected</span>
                <p className="text-3xl font-black text-red-700">{rejectedEvents}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-blue-900 uppercase tracking-wider">Registered Attendees</span>
                <p className="text-3xl font-black text-blue-900">{approvedAttendees.length}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Pending Approval</span>
                <p className="text-3xl font-black text-amber-700">{pendingForApproval}</p>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: MY EVENTS (CONDITIONAL ACTION BUTTONS) */}
        {activeTab === "my-events" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">My Submitted Events</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Manage and review your submitted event proposals.</p>
              </div>
              <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("overview")}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
              >
                &larr; Back to Overview
              </button>
                <Link href="/programs/submit">
                  <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs transition-all whitespace-nowrap">
                    + Create Event
                  </button>
                </Link>
              </div>
            </div>

            {events.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                No events submitted yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {events.map((event) => {
                  const status = (event.status || "").toLowerCase();
                  const isApproved = status === "approved" || status === "upcoming" || status === "ongoing";
                  const isRejectedOrRevision = status === "rejected" || status === "requires changes";

                  return (
                    <div key={event.id} className="bg-white p-5 rounded-2xl border border-gray-200 flex flex-col md:flex-row justify-between gap-5 shadow-sm">
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
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="font-black text-base text-slate-900">{event.event_name}</h3>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${statusBadge(event.status)}`}>
                            {event.status || "Pending"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">{event.description}</p>
                        <p className="text-xs font-semibold text-gray-500">
                          Venue: {event.venue || "TBA"} | Date: {event.event_date || "TBA"} | Time: {event.event_time || "TBA"}
                        </p>
                        {isRejectedOrRevision && (event.revision_notes || event.rejection_reason) && (
                          <p className="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-xl p-3">
                            <strong>Admin note:</strong> {event.revision_notes || event.rejection_reason}
                          </p>
                        )}
                      </div>

                      {/* CONDITIONAL ACTION BUTTONS BASED ON STATUS */}
                      <div className="flex items-center gap-2">
                        {isRejectedOrRevision && (
                          <button
                            onClick={() => setEditingEvent(event)}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg uppercase transition-all"
                          >
                            Edit Details
                          </button>
                        )}

                        {isApproved && (
                          <button
                            onClick={() => setCancelingEvent(event)}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg uppercase transition-all"
                          >
                            Request Cancellation
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

        {/* VIEW 3: ATTENDEES LIST & PER-CARD EXPANDABLE SORTING (APPROVED EVENTS ONLY) */}
        {activeTab === "attendees" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Approved Event Attendees
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Click on any approved event card below to inspect and sort its registered attendees.
                </p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
              >
                &larr; Back to Overview
              </button>
            </div>

            {approvedEventsList.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                No approved events available to display attendees.
              </div>
            ) : (
              <div className="space-y-4">
                {approvedEventsList.map((event) => {
                  const eventAttendees = attendees.filter((a) => String(a.event_id) === String(event.id));
                  const isExpanded = expandedEventId === event.id;

                  const currentFilters = eventFilters[event.id] || { gender: "All", ageBracket: "All" };
                  const filteredCardAttendees = eventAttendees.filter((a) => {
                    if (currentFilters.gender !== "All" && a.gender?.toLowerCase() !== currentFilters.gender.toLowerCase()) return false;
                    const age = parseInt(a.age, 10) || 0;
                    if (currentFilters.ageBracket === "Youth (1-17)" && age >= 18) return false;
                    if (currentFilters.ageBracket === "Adult (18-59)" && (age < 18 || age > 59)) return false;
                    if (currentFilters.ageBracket === "Senior (60+)" && age < 60) return false;
                    return true;
                  });

                  return (
                    <div key={event.id} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="font-black text-base text-slate-900">{event.event_name}</h3>
                            <span className={`px-2.5 py-0.5 text-[9px] font-black rounded-full uppercase ${statusBadge(event.status)}`}>
                              {event.status || "Approved"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Date: {event.event_date || "TBA"} | Total Registered: <strong>{eventAttendees.length}</strong>
                          </p>
                        </div>
                        <button
                          onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                        >
                          {isExpanded ? "Hide Attendees ▲" : "Inspect Attendees ▼"}
                        </button>
                      </div>

                      {/* EXPANDED EVENT CARD CONTAINER WITH INTERNAL SORT & CATEGORY CONTROLS */}
                      {isExpanded && (
                        <div className="pt-4 border-t border-gray-100 space-y-4">
                          <div className="flex flex-col md:flex-row justify-between items-center bg-gray-50 p-4 rounded-xl gap-3 text-xs">
                            <span className="font-bold uppercase text-slate-700">
                              Participants Filter ({filteredCardAttendees.length})
                            </span>
                            <div className="flex flex-wrap gap-2">
                              <select
                                value={currentFilters.gender}
                                onChange={(e) => setEventFilters({
                                  ...eventFilters,
                                  [event.id]: { ...currentFilters, gender: e.target.value }
                                })}
                                className="p-2 border rounded-xl bg-white focus:outline-none"
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
                                className="p-2 border rounded-xl bg-white focus:outline-none"
                              >
                                <option value="All">All Age Brackets</option>
                                <option value="Youth (1-17)">Youth (1-17)</option>
                                <option value="Adult (18-59)">Adult (18-59)</option>
                                <option value="Senior (60+)">Senior (60+)</option>
                              </select>
                            </div>
                          </div>

                          {filteredCardAttendees.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 text-xs font-bold uppercase">
                              No registered attendees match the filter criteria for this event.
                            </div>
                          ) : (
                            <div className="border rounded-xl overflow-hidden">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 font-bold uppercase text-gray-500 border-b">
                                  <tr>
                                    <th className="p-3">Participant Name</th>
                                    <th className="p-3">Contact Info</th>
                                    <th className="p-3">Gender</th>
                                    <th className="p-3">Age</th>
                                    <th className="p-3">Home Address</th>
                                    <th className="p-3">Registered Date</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y text-gray-700 font-medium">
                                  {filteredCardAttendees.map((a) => (
                                    <tr key={a.id}>
                                      <td className="p-3 font-bold text-slate-900">{a.first_name} {a.last_name}</td>
                                      <td className="p-3">{a.email}<br /><span className="text-[10px] text-gray-400">{a.phone_number}</span></td>
                                      <td className="p-3 font-bold">{a.gender}</td>
                                      <td className="p-3 font-bold">{a.age} yrs</td>
                                      <td className="p-3">{a.home_address}</td>
                                      <td className="p-3">{new Date(a.created_at).toLocaleDateString()}</td>
                                    </tr>
                                  ))}
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

        {/* VIEW 4: NOTIFICATIONS (built from admin review activity on your events) */}
        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Notifications & Updates</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Review decisions from the Tourism Office on your events.</p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
              >
                &larr; Back to Overview
              </button>
            </div>
            <div className="space-y-3">
              {events.length === 0 && (
                <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                  No updates yet. Submit an event proposal to get started.
                </div>
              )}
              {events.map((event) => {
                const status = (event.status || "Pending").toLowerCase();
                const messages = {
                  pending: "Your proposal is waiting for review by the Tourism Office.",
                  "under review": "Your proposal is being reviewed by the Tourism Office.",
                  approved: "Approved. Your event is now listed on the public schedule.",
                  upcoming: "Approved. Your event is now listed on the public schedule.",
                  ongoing: "Your event is currently running.",
                  completed: "This event has been marked as completed.",
                  rejected: "Your proposal was rejected.",
                  "requires changes": "The Tourism Office asked for changes before approval.",
                  "cancellation requested": "Your cancellation request is waiting for admin approval.",
                  cancelled: "This event has been cancelled.",
                };
                const note = event.revision_notes || event.rejection_reason;
                return (
                  <div key={event.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-blue-600 uppercase tracking-wider">{event.status || "Pending"}</span>
                      {event.created_at && (
                        <span className="text-[10px] text-gray-400 font-semibold">{new Date(event.created_at).toLocaleDateString()}</span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-slate-900">{event.event_name}</p>
                    <p className="text-xs text-gray-600">{messages[status] || "Status updated by the Tourism Office."}</p>
                    {note && !["approved", "upcoming", "ongoing", "completed"].includes(status) && (
                      <p className="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-xl p-3 mt-2">
                        <strong>Admin note:</strong> {note}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 5: ORGANIZER PROFILE */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Organizer Verification Profile</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Your official registered entity information.</p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
              >
                &larr; Back to Overview
              </button>
            </div>
            <div className="bg-white p-8 rounded-2xl border border-gray-200 space-y-4 text-xs font-semibold shadow-sm max-w-2xl">
              <div className="flex items-center gap-4 pb-4 border-b">
                {profile?.logo_url && (
                  <img src={profile.logo_url} alt="Organization Logo" className="w-16 h-16 object-cover rounded-xl border" />
                )}
                <div>
                  <p className="text-base font-black text-slate-900">{profile?.organization}</p>
                  <p className="text-gray-500">{profile?.email}</p>
                </div>
              </div>
              <p><strong>Representative Full Name:</strong> {profile?.organizer_full_name || profile?.full_name}</p>
              <p><strong>Organization Type:</strong> {profile?.org_type || "N/A"}</p>
              <p><strong>Contact Phone:</strong> {profile?.contact_number || "N/A"}</p>
              <p><strong>Office Address:</strong> {profile?.address || "N/A"}</p>

              <div>
                <p className="mb-1"><strong>Business Permit No:</strong></p>
                {profile?.business_permit_no ? (
                  profile.business_permit_no.startsWith("data:image") || profile.business_permit_no.startsWith("http") ? (
                    <button type="button" onClick={() => setViewerSrc(profile.business_permit_no)} className="block" aria-label="View full Business Permit">
<img src={profile.business_permit_no} alt="Business Permit" className="h-28 object-cover rounded-xl border hover:opacity-90" />
</button>
                  ) : (
                    <span className="text-slate-800">{profile.business_permit_no}</span>
                  )
                ) : (
                  <span className="text-gray-400">N/A</span>
                )}
              </div>

              <div>
                <p className="mb-1"><strong>BIR TIN No:</strong></p>
                {profile?.bir_tin ? (
                  profile.bir_tin.startsWith("data:image") || profile.bir_tin.startsWith("http") ? (
                    <button type="button" onClick={() => setViewerSrc(profile.bir_tin)} className="block" aria-label="View full BIR TIN">
<img src={profile.bir_tin} alt="BIR TIN" className="h-28 object-cover rounded-xl border hover:opacity-90" />
</button>
                  ) : (
                    <span className="text-slate-800">{profile.bir_tin}</span>
                  )
                ) : (
                  <span className="text-gray-400">N/A</span>
                )}
              </div>

              <div>
                <p className="mb-1"><strong>DTI / SEC Reg No:</strong></p>
                {profile?.dti_sec_reg ? (
                  profile.dti_sec_reg.startsWith("data:image") || profile.dti_sec_reg.startsWith("http") ? (
                    <button type="button" onClick={() => setViewerSrc(profile.dti_sec_reg)} className="block" aria-label="View full DTI SEC Reg">
<img src={profile.dti_sec_reg} alt="DTI SEC Reg" className="h-28 object-cover rounded-xl border hover:opacity-90" />
</button>
                  ) : (
                    <span className="text-slate-800">{profile.dti_sec_reg}</span>
                  )
                ) : (
                  <span className="text-gray-400">N/A</span>
                )}
              </div>

              {profile?.valid_id_url && (
                <div className="pt-2">
                  <p className="mb-1"><strong>Representative Valid ID:</strong></p>
                  <button type="button" onClick={() => setViewerSrc(profile.valid_id_url)} className="block" aria-label="View full Valid ID">
<img src={profile.valid_id_url} alt="Valid ID" className="h-28 object-cover rounded-xl border hover:opacity-90" />
</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 6: ACCOUNT SETTINGS */}
        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Account & Security Settings</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Manage your organizer login credentials.</p>
              </div>
              <button
                onClick={() => setActiveTab("overview")}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
              >
                &larr; Back to Overview
              </button>
            </div>
            <div className="bg-white p-8 rounded-2xl border border-gray-200 max-w-md space-y-4 text-xs font-semibold shadow-sm">
              <div>
                <label className="block text-gray-600 mb-1">REGISTERED EMAIL</label>
                <input type="email" disabled value={newEmail} className="w-full p-3 bg-gray-100 rounded-xl font-bold text-slate-700" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">NEW PASSWORD</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
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
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase shadow-sm transition-all"
              >
                {pwSaved ? "Saved \u2713" : "Save Account Settings"}
              </button>
            </div>
          </div>
        )}
      </main>

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}

      {/* --- EDIT EVENT MODAL --- */}
      {editingEvent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[35px] max-w-lg w-full p-8 shadow-2xl space-y-6">
            <div>
              <span className="text-[10px] font-black text-blue-700 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Event Revision Form
              </span>
              <h2 className="text-2xl font-black text-gray-900 mt-2">Edit Event Details</h2>
              <p className="text-xs text-gray-500 mt-1">
                Updating image, description, or schedule will resubmit your event for review.
              </p>
            </div>

            <form onSubmit={handleSaveEventEdit} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-gray-600 mb-1">IMAGE URL</label>
                <input
                  type="url"
                  value={editingEvent.image_url || ""}
                  onChange={(e) => setEditingEvent({ ...editingEvent, image_url: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">DESCRIPTION</label>
                <textarea
                  rows="3"
                  value={editingEvent.description || ""}
                  onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">EVENT TIME</label>
                <input
                  type="text"
                  value={editingEvent.event_time || ""}
                  onChange={(e) => setEditingEvent({ ...editingEvent, event_time: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold uppercase tracking-wider transition-all"
                >
                  Save & Resubmit
                </button>
                <button
                  type="button"
                  onClick={() => setEditingEvent(null)}
                  className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-all"
                >
                  &larr; Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- CANCELLATION REQUEST MODAL --- */}
      {cancelingEvent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[35px] max-w-md w-full p-8 shadow-2xl space-y-6">
            <div>
              <span className="text-[10px] font-black text-red-700 bg-red-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Event Cancellation
              </span>
              <h2 className="text-xl font-black text-gray-900 mt-2">
                Request Cancellation for "{cancelingEvent.event_name}"
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Please provide a reason to notify the Tourism Office admin.
              </p>
            </div>

            <form onSubmit={handleRequestCancellation} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-gray-600 mb-1">CANCELLATION REASON *</label>
                <textarea
                  rows="4"
                  required
                  placeholder="State why this approved event must be cancelled..."
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  Submit Request
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCancelingEvent(null);
                    setCancellationReason("");
                  }}
                  className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-all"
                >
                  &larr; Back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}