"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";

const norm = (s) => (s || "").trim().toLowerCase();

// Public phase of an event as set by the admin (Approved counts as Upcoming)
const getPhase = (status) => {
  const st = norm(status);
  if (st === "ongoing") return "Ongoing";
  if (st === "completed") return "Completed";
  return "Upcoming";
};

const phaseBadge = {
  Upcoming: "bg-blue-100 text-blue-800",
  Ongoing: "bg-emerald-100 text-emerald-800",
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

  // 'my-events' | 'notifications' | 'account' | 'settings'
  const [activeTab, setActiveTab] = useState("my-events");

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [registrations, setRegistrations] = useState([]);
  const [eventsMap, setEventsMap] = useState({});
  const [eventsFetchOk, setEventsFetchOk] = useState(true);
  const [viewerSrc, setViewerSrc] = useState(null);

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
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Keep event details (status, photo, schedule) in sync with admin / organizer changes
    const channel = supabase
      .channel("tourist-dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tourism_programs" }, () => fetchData(true))
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

      // Remove it from the screen right away
      setRegistrations((prev) => prev.filter((r) => r.id !== registrationId));
      await fetchData(true);
    } catch (err) {
      console.error("Cancel registration error:", err);
      notify("Error cancelling registration: " + err.message);
    }
  };

  // Cancelled events (and events that no longer exist) are hidden from the tourist
  const visibleRegistrations = registrations.filter((reg) => {
    const ev = eventsMap[reg.event_id];
    if (!ev) return !eventsFetchOk;
    return norm(ev.status) !== "cancelled";
  });

  const navBtn = (tab) =>
    `w-full text-left px-3.5 py-2.5 rounded-xl transition-all ${
      activeTab === tab
        ? "bg-slate-800 text-blue-400 shadow-md border-l-4 border-blue-500"
        : "text-slate-300 hover:bg-slate-800/60"
    }`;

  const BackButton = ({ to = "my-events", label = "Back to My Events" }) => (
    <button
      onClick={() => setActiveTab(to)}
      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all whitespace-nowrap"
    >
      &larr; {label}
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-xs font-bold uppercase tracking-widest text-gray-400">
        Loading tourist portal...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row text-gray-800">
      {/* Sidebar: sticky, actions sit directly under the nav so they never need scrolling */}
      <aside className="w-full md:w-72 bg-slate-900 text-white flex-shrink-0 shadow-xl">
        <div className="md:sticky md:top-0 md:max-h-screen md:overflow-y-auto p-5 flex flex-col gap-4">
        <div className="border-b border-slate-800 pb-3">
          <span className="px-2.5 py-0.5 bg-blue-600/30 text-blue-300 text-[9px] font-bold rounded-full uppercase tracking-wider">
            Tourist Portal
          </span>
          <h2 className="text-base font-black italic uppercase text-white mt-1.5 truncate">
            {profile?.full_name || "Tourist Account"}
          </h2>
          <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">{user?.email}</p>
        </div>

        <nav className="space-y-1 text-xs font-bold uppercase tracking-wider">
          <button onClick={() => setActiveTab("my-events")} className={navBtn("my-events")}>
            My Events
          </button>
          <button
            onClick={() => setActiveTab("notifications")}
            className={`${navBtn("notifications")} flex justify-between items-center`}
          >
            <span>Notifications</span>
            {visibleRegistrations.length > 0 && (
              <span className="px-2 py-0.5 bg-blue-600 text-white font-black text-[9px] rounded-full">
                {visibleRegistrations.length}
              </span>
            )}
          </button>
          <button onClick={() => setActiveTab("account")} className={navBtn("account")}>
            My Account Details
          </button>
          <button onClick={() => setActiveTab("settings")} className={navBtn("settings")}>
            Account Settings
          </button>
        </nav>

        <div className="pt-3 border-t border-slate-800 space-y-2">
          <Link href="/programs" className="block">
            <button className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all text-center shadow-sm uppercase tracking-wider">
              Explore Events &rarr;
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

      <main className="flex-1 p-6 md:p-10 space-y-8 min-w-0">
        {activeTab === "my-events" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">My Registered Events</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Manage and view the status of events you are participating in.</p>
              </div>
              <Link href="/programs">
                <button className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-all">
                  Browse More Events &rarr;
                </button>
              </Link>
            </div>

            {visibleRegistrations.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center space-y-3">
                <p className="text-gray-400 text-xs font-bold uppercase">You haven't registered for any active events yet.</p>
                <Link href="/programs">
                  <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs transition-all">
                    Find an event to join
                  </button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {visibleRegistrations.map((reg) => {
                  const event = eventsMap[reg.event_id] || {};
                  return (
                    <div key={reg.id} className="bg-white p-5 rounded-2xl border border-gray-200 flex flex-col md:flex-row gap-5 shadow-sm">
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
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-black text-base text-slate-900">{event.event_name || "Municipal Event"}</h3>
                          <span className="px-2.5 py-1 text-[10px] font-black bg-emerald-100 text-emerald-800 rounded-full uppercase">
                            Registered
                          </span>
                          <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${phaseBadge[getPhase(event.status)]}`}>
                            {getPhase(event.status) === "Ongoing" ? "Happening now" : getPhase(event.status)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{event.description || "No event description provided."}</p>
                        <div className="text-xs font-semibold text-gray-500 space-y-0.5 bg-gray-50 p-3 rounded-xl border border-gray-100">
                          <p><strong>Organizer:</strong> {event.organizer_name || "Municipal Tourism Office"}</p>
                          <p><strong>Venue:</strong> {event.venue || "TBA"}</p>
                          <p><strong>Date & Time:</strong> {formatDate(event.event_date || event.date)} | {event.event_time || "TBA"}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full md:w-auto">
                        {getPhase(event.status) === "Completed" ? (
                          <span className="w-full md:w-auto px-4 py-2.5 bg-gray-100 text-gray-500 text-xs font-bold rounded-xl uppercase text-center">
                            Event completed
                          </span>
                        ) : (
                          <button
                            onClick={() => handleCancelRegistration(reg.id)}
                            className="w-full md:w-auto px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-xl uppercase transition-all shadow-sm"
                          >
                            Cancel Registration
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

        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Notifications & Event Alerts</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Real-time status updates for your registered municipal activities.</p>
              </div>
              <BackButton />
            </div>

            {visibleRegistrations.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 text-xs font-bold uppercase">
                No active notifications or updates available.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRegistrations.map((reg) => {
                  const event = eventsMap[reg.event_id] || {};
                  const phase = getPhase(event.status);
                  return (
                    <div key={reg.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-wider">
                          {phase === "Upcoming" ? "Registration Notice" : "Event Update"}
                        </span>
                        <span className="text-[10px] text-gray-400 font-semibold">{new Date(reg.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-xs font-bold text-slate-900">
                        <span className="text-blue-900">{event.event_name || "Municipal Program"}</span>{" "}
                        {phase === "Ongoing"
                          ? "is happening now. Enjoy the event!"
                          : phase === "Completed"
                          ? "has been completed. Thank you for taking part."
                          : "registration is confirmed."}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        Location: {event.venue || "TBA"} | Scheduled Date: {formatDate(event.event_date || event.date)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "account" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">My Account Details</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">The information registered with your tourist account.</p>
              </div>
              <BackButton />
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm max-w-2xl overflow-hidden">
              <div className="flex items-center gap-4 p-6 border-b border-gray-100 bg-gradient-to-r from-blue-900 to-indigo-900 text-white">
                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-xl font-black">
                  {(profile?.full_name || user?.email || "T").trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-black truncate">{profile?.full_name || "Tourist Account"}</p>
                  <p className="text-xs text-blue-200 truncate">{user?.email}</p>
                </div>
              </div>

              <dl className="divide-y divide-gray-100 text-xs">
                {accountRows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-4 px-6 py-3.5">
                    <dt className="font-bold text-gray-500">{label}</dt>
                    <dd className="col-span-2 font-semibold text-slate-800 break-words">
                      {value !== undefined && value !== null && value !== "" ? String(value) : <span className="text-gray-300">Not provided</span>}
                    </dd>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-4 px-6 py-3.5">
                  <dt className="font-bold text-gray-500">Active registrations</dt>
                  <dd className="col-span-2 font-semibold text-slate-800">{visibleRegistrations.length}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Account & Password Security</h1>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Update your tourist portal login password and account preferences.</p>
              </div>
              <BackButton />
            </div>

            <div className="bg-white p-8 rounded-2xl border border-gray-200 max-w-md space-y-4 text-xs font-semibold shadow-sm">
              <div>
                <label className="block text-gray-600 mb-1">ACCOUNT EMAIL</label>
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

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Event photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}
    </div>
  );
}