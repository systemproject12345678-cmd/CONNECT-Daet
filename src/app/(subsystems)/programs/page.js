"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Button from "@/components/ui/Button";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";

const DEFAULT_EVENT_IMAGE =
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80";

// Statuses that may be shown to the public. Cancelled, rejected, pending and
// "requires changes" events are never listed on the guest schedule.
const PUBLIC_STATUSES = ["approved", "upcoming", "ongoing", "completed", "cancellation requested"];

const norm = (s) => (s || "").trim().toLowerCase();

// Public phase used for the filter tabs and badges.
const getPhase = (status) => {
  const s = norm(status);
  if (s === "ongoing") return "Ongoing";
  if (s === "completed") return "Completed";
  return "Upcoming"; // approved / upcoming / cancellation requested
};

const parseDate = (v) => {
  if (!v) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const formatLongDate = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" }) : "Date to be announced";
};

const phaseBadge = {
  Upcoming: "bg-blue-600 text-white",
  Ongoing: "bg-emerald-500 text-white",
  Completed: "bg-gray-700 text-white",
};

export default function ProgramsPage() {
  const router = useRouter();
  const { notify, feedbackUI } = useFeedback();

  // Authentication State
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  // Event Data & Filtering
  const [events, setEvents] = useState([]);
  const [fetchingEvents, setFetchingEvents] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");
  const [search, setSearch] = useState("");

  // Modals State
  const [viewingDetailsEvent, setViewingDetailsEvent] = useState(null);
  const [participatingEvent, setParticipatingEvent] = useState(null);
  const [authRequiredEvent, setAuthRequiredEvent] = useState(null);
  const [viewerSrc, setViewerSrc] = useState(null);
  const [myRegisteredIds, setMyRegisteredIds] = useState([]);

  // Registration Form State
  const [regForm, setRegForm] = useState({
    firstName: "",
    lastName: "",
    gender: "Male",
    age: "",
    civilStatus: "Single",
    homeAddress: "",
    phoneNumber: "",
    email: "",
  });
  const [submittingReg, setSubmittingReg] = useState(false);

  // Official Admin Email Check
  const OFFICIAL_ADMIN_EMAIL = "admin.daet@gmail.com";

  // 1. Check Auth & Profile Role
  useEffect(() => {
    const loadProfile = async (sessionUser) => {
      if (!sessionUser) {
        setUser(null);
        setUserProfile(null);
        return;
      }
      setUser(sessionUser);
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", sessionUser.id)
        .single();

      setUserProfile(profile);
      setRegForm((prev) => ({
        ...prev,
        email: sessionUser.email || "",
        firstName: profile?.full_name ? profile.full_name.split(" ")[0] : "",
        lastName: profile?.full_name ? profile.full_name.split(" ").slice(1).join(" ") : "",
      }));
    };

    supabase.auth.getSession().then(({ data: { session } }) => loadProfile(session?.user || null));

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (!session?.user) setUserProfile(null);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  // Which events has this tourist already joined?
  useEffect(() => {
    if (!user?.id) {
      setMyRegisteredIds([]);
      return;
    }
    supabase
      .from("event_registrations")
      .select("event_id")
      .eq("user_id", user.id)
      .then(({ data }) => setMyRegisteredIds((data || []).map((r) => String(r.event_id))));
  }, [user?.id]);

  // 2. Fetch public events (cancelled / unverified ones are filtered out below)
  const fetchEvents = async (silent = false) => {
    if (!silent) setFetchingEvents(true);
    try {
      const { data, error } = await supabase
        .from("tourism_programs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setEvents((data || []).filter((e) => PUBLIC_STATUSES.includes(norm(e.status))));
    } catch (error) {
      console.error("Error fetching tourism programs:", error.message || error);
    } finally {
      setFetchingEvents(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchEvents(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 3. Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserProfile(null);
    router.push("/programs");
  };

  const isAdmin =
    user && (user.email?.toLowerCase() === OFFICIAL_ADMIN_EMAIL.toLowerCase() || userProfile?.role === "admin");

  // 4. Handle Participation Trigger with Role Checks
  const handleParticipateClick = (e, event) => {
    e?.stopPropagation?.();
    if (!user) {
      setAuthRequiredEvent(event);
    } else if (isAdmin) {
      notify("Administrators manage events from the Admin Control Center and cannot register as participants.", "info");
    } else if (userProfile?.role === "organizer") {
      notify("Event organizers manage programs from the Organizer Control Center and cannot join as tourists.", "info");
    } else if (userProfile && userProfile.status !== "Approved") {
      notify("Your account is still pending admin verification.", "info");
    } else if (norm(event.status) === "completed") {
      notify("This event has already been completed.", "info");
    } else if (myRegisteredIds.includes(String(event.id))) {
      notify("You are already registered for this event. You can review it in your Tourist Portal.", "info");
    } else {
      setParticipatingEvent(event);
    }
  };

  // 5. Submit Event Registration
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setSubmittingReg(true);

    try {
      // Prevent duplicate registrations for the same tourist + event
      const { data: existing } = await supabase
        .from("event_registrations")
        .select("id")
        .eq("event_id", participatingEvent.id)
        .eq("user_id", user.id)
        .limit(1);

      if (existing && existing.length > 0) {
        setMyRegisteredIds((prev) => [...new Set([...prev, String(participatingEvent.id)])]);
        setParticipatingEvent(null);
        notify("You are already registered for this event. You can review it in your Tourist Portal.", "info");
        return;
      }

      const { error } = await supabase.from("event_registrations").insert([
        {
          event_id: participatingEvent.id,
          user_id: user.id,
          first_name: regForm.firstName.trim(),
          last_name: regForm.lastName.trim(),
          gender: regForm.gender,
          age: parseInt(regForm.age, 10),
          civil_status: regForm.civilStatus,
          home_address: regForm.homeAddress.trim(),
          phone_number: regForm.phoneNumber.trim(),
          email: regForm.email.trim(),
        },
      ]);

      if (error) throw error;

      // Straight back to the schedule: the card now shows "Registered"
      setMyRegisteredIds((prev) => [...new Set([...prev, String(participatingEvent.id)])]);
      setParticipatingEvent(null);
    } catch (err) {
      console.error("Registration submission error:", err);
      notify("Error submitting registration: " + err.message);
    } finally {
      setSubmittingReg(false);
    }
  };

  // Sorted + filtered list: ongoing first, then upcoming by date, completed last
  const visibleEvents = useMemo(() => {
    const rank = { Ongoing: 0, Upcoming: 1, Completed: 2 };
    const q = search.trim().toLowerCase();

    return events
      .filter((event) => {
        const phase = getPhase(event.status);
        if (activeFilter !== "All" && phase !== activeFilter) return false;
        if (!q) return true;
        return [event.event_name, event.venue, event.organizer_name, event.description]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const pa = getPhase(a.status);
        const pb = getPhase(b.status);
        if (rank[pa] !== rank[pb]) return rank[pa] - rank[pb];
        const da = parseDate(a.event_date || a.date)?.getTime() ?? Infinity;
        const db = parseDate(b.event_date || b.date)?.getTime() ?? Infinity;
        return pa === "Completed" ? db - da : da - db;
      });
  }, [events, activeFilter, search]);

  const counts = useMemo(() => {
    const c = { All: events.length, Upcoming: 0, Ongoing: 0, Completed: 0 };
    events.forEach((e) => {
      c[getPhase(e.status)] += 1;
    });
    return c;
  }, [events]);

  const featuredEvent = useMemo(() => {
    const live = events.filter((e) => getPhase(e.status) !== "Completed");
    if (live.length === 0) return null;
    return [...live].sort((a, b) => {
      const oa = getPhase(a.status) === "Ongoing" ? 0 : 1;
      const ob = getPhase(b.status) === "Ongoing" ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const da = parseDate(a.event_date || a.date)?.getTime() ?? Infinity;
      const db = parseDate(b.event_date || b.date)?.getTime() ?? Infinity;
      return da - db;
    })[0];
  }, [events]);

  const eventImage = (ev) => ev?.image_url || DEFAULT_EVENT_IMAGE;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-10">
      {/* Account bar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-gray-100 pb-6">
        <div>
          <span className="px-3 py-1 bg-blue-100 text-blue-800 text-[10px] font-black rounded-full uppercase tracking-wider">
            Public Gateway
          </span>
          <h1 className="text-3xl font-black italic uppercase text-blue-900 mt-1">Daet Municipal Events</h1>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <>
              {isAdmin ? (
                <Link href="/admin">
                  <button className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white font-bold rounded-xl text-xs transition-all shadow-sm">
                    &larr; Back to Admin Control Center
                  </button>
                </Link>
              ) : userProfile?.role === "organizer" ? (
                <>
                  <span className="text-xs text-gray-600 font-semibold">
                    Logged in: <strong className="text-blue-900">{user.email}</strong>
                  </span>
                  <Link href="/organizer/dashboard">
                    <Button variant="primary" className="text-xs py-2 px-4">
                      &larr; Back to Organizer Dashboard
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <span className="text-xs text-gray-600 font-semibold">
                    Logged in: <strong className="text-blue-900">{user.email}</strong>
                  </span>
                  <Link href="/tourist/dashboard">
                    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                      Open Tourist Portal &rarr;
                    </button>
                  </Link>
                </>
              )}
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition-all"
              >
                Log Out
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="secondary" className="text-xs py-2 px-5">
                  Log In
                </Button>
              </Link>
              <Link href="/register">
                <button className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md transition-all">
                  Register Account
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Hero: headline + search on the left, the next event on the right */}
      <section className="relative overflow-hidden rounded-[35px] bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 text-white shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
          <div className="lg:col-span-3 p-8 md:p-12 flex flex-col justify-center space-y-6">
            <div className="space-y-3">
              <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tight leading-[1.05]">
                Festivals, fiestas and programs across Daet
              </h2>
              <p className="text-blue-100 text-sm leading-relaxed max-w-lg">
                Browse every verified event, open a card to see the full photo and details, and sign up with a tourist
                account when you are ready to join.
              </p>
            </div>

            <div className="relative max-w-md">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by event, venue or organizer"
                className="w-full pl-4 pr-4 py-3.5 rounded-2xl bg-white text-gray-800 text-sm placeholder:text-gray-400 shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-400/40"
                aria-label="Search events"
              />
            </div>

            <dl className="flex gap-8 text-sm">
              <div>
                <dt className="text-blue-200 text-xs">Upcoming</dt>
                <dd className="text-2xl font-black">{counts.Upcoming}</dd>
              </div>
              <div>
                <dt className="text-blue-200 text-xs">Happening now</dt>
                <dd className="text-2xl font-black">{counts.Ongoing}</dd>
              </div>
              <div>
                <dt className="text-blue-200 text-xs">Completed</dt>
                <dd className="text-2xl font-black">{counts.Completed}</dd>
              </div>
            </dl>

            {userProfile?.role === "organizer" && (
              <div>
                <Link href="/programs/submit">
                  <button className="px-5 py-3 bg-white text-blue-900 hover:bg-blue-50 rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg transition-all">
                    Submit Event Proposal &rarr;
                  </button>
                </Link>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 p-6 md:p-8 lg:pl-0 flex items-center">
            {featuredEvent ? (
              <div className="w-full bg-white rounded-3xl overflow-hidden shadow-2xl text-gray-900">
                <button
                  type="button"
                  onClick={() => setViewerSrc(eventImage(featuredEvent))}
                  className="relative block w-full h-52 bg-blue-900 group"
                  aria-label={`View full photo of ${featuredEvent.event_name}`}
                >
                  <img src={eventImage(featuredEvent)} alt={featuredEvent.event_name} className="w-full h-full object-cover" />
                  <span className="absolute bottom-3 right-3 px-3 py-1 bg-black/60 text-white text-[11px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    View full photo
                  </span>
                </button>
                <div className="p-5 space-y-2">
                  <span className={`inline-block px-2.5 py-0.5 text-[10px] font-black rounded-full ${phaseBadge[getPhase(featuredEvent.status)]}`}>
                    {getPhase(featuredEvent.status) === "Ongoing" ? "Happening now" : "Next up"}
                  </span>
                  <h3 className="text-lg font-black text-blue-900 leading-snug">{featuredEvent.event_name}</h3>
                  <p className="text-xs text-gray-500 font-medium">
                    {formatLongDate(featuredEvent.event_date || featuredEvent.date)} &middot; {featuredEvent.venue || "Venue to be announced"}
                  </p>
                  <button
                    onClick={() => setViewingDetailsEvent(featuredEvent)}
                    className="mt-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    See details
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full rounded-3xl border border-white/20 bg-white/10 p-8 text-center text-blue-100 text-sm">
                No upcoming events are listed yet. Check back soon.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Schedule */}
      <section id="public-schedule" className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 pb-4">
          <div>
            <h2 className="text-2xl font-black text-blue-900 uppercase tracking-tight">Official Event Schedule</h2>
            <p className="text-xs font-semibold text-gray-400 mt-1">
              Showing {visibleEvents.length} verified {visibleEvents.length === 1 ? "event" : "events"}
              {search.trim() ? ` matching "${search.trim()}"` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 bg-gray-100 p-1.5 rounded-2xl" role="tablist" aria-label="Filter events by status">
            {["All", "Upcoming", "Ongoing", "Completed"].map((filter) => (
              <button
                key={filter}
                role="tab"
                aria-selected={activeFilter === filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  activeFilter === filter ? "bg-white text-blue-900 shadow-md" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {filter} <span className="text-gray-400 font-semibold">{counts[filter]}</span>
              </button>
            ))}
          </div>
        </div>

        {fetchingEvents && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-3xl bg-white border border-gray-100 overflow-hidden animate-pulse">
                <div className="h-52 bg-gray-100" />
                <div className="p-6 space-y-3">
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!fetchingEvents && visibleEvents.length === 0 && (
          <div className="text-center py-14 bg-white rounded-3xl border border-dashed border-gray-200 space-y-3">
            <p className="text-sm font-bold text-gray-500">
              {search.trim() || activeFilter !== "All"
                ? "No events match these filters."
                : "No events are scheduled right now."}
            </p>
            {(search.trim() || activeFilter !== "All") && (
              <button
                onClick={() => {
                  setSearch("");
                  setActiveFilter("All");
                }}
                className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-all"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {!fetchingEvents && visibleEvents.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleEvents.map((item) => {
              const phase = getPhase(item.status);
              const date = parseDate(item.event_date || item.date);
              return (
                <article
                  key={item.id}
                  onClick={() => setViewingDetailsEvent(item)}
                  className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-blue-50 border border-blue-50 hover:border-blue-300 hover:shadow-xl transition-all cursor-pointer flex flex-col"
                >
                  <div className="relative h-52 w-full bg-blue-900 overflow-hidden group">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewerSrc(eventImage(item));
                      }}
                      className="block w-full h-full"
                      aria-label={`View full photo of ${item.event_name}`}
                    >
                      <img src={eventImage(item)} alt={item.event_name} className="w-full h-full object-cover" />
                      <span className="absolute bottom-3 right-3 px-3 py-1 bg-black/60 text-white text-[11px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        View full photo
                      </span>
                    </button>

                    {date && (
                      <div className="absolute top-3 left-3 bg-white rounded-2xl px-3 py-1.5 text-center shadow-md leading-none pointer-events-none">
                        <div className="text-[10px] font-bold text-blue-600">{date.toLocaleDateString(undefined, { month: "short" })}</div>
                        <div className="text-xl font-black text-blue-900">{date.getDate()}</div>
                      </div>
                    )}

                    <span className={`absolute top-3 right-3 text-[10px] font-black px-3 py-1 rounded-full pointer-events-none ${phaseBadge[phase]}`}>
                      {phase}
                    </span>
                  </div>

                  <div className="p-5 space-y-2 flex-grow">
                    <h3 className="font-black text-gray-900 text-lg leading-snug">{item.event_name}</h3>
                    <p className="text-gray-500 text-xs leading-relaxed line-clamp-2">
                      {item.description || "No description provided."}
                    </p>
                    <dl className="text-xs text-gray-600 space-y-1 pt-2 font-medium">
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Venue</dt><dd className="truncate">{item.venue || "To be announced"}</dd></div>
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Host</dt><dd className="truncate">{item.organizer_name || "Municipal Tourism Office"}</dd></div>
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Date</dt><dd>{formatLongDate(item.event_date || item.date)}</dd></div>
                    </dl>
                  </div>

                  <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-2">
                    <button
                      onClick={(e) => handleParticipateClick(e, item)}
                      disabled={phase === "Completed" || myRegisteredIds.includes(String(item.id))}
                      className={`flex-1 py-2.5 disabled:cursor-not-allowed rounded-xl font-bold text-xs transition-all shadow-sm ${
                        myRegisteredIds.includes(String(item.id))
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500 text-white"
                      }`}
                    >
                      {myRegisteredIds.includes(String(item.id))
                        ? "Registered \u2713"
                        : phase === "Completed"
                        ? "Event ended"
                        : "Join this event"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewingDetailsEvent(item);
                      }}
                      className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl font-bold text-xs transition-all"
                    >
                      Details
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* --- MODAL 1: FULL EVENT DETAILS --- */}
      {viewingDetailsEvent && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setViewingDetailsEvent(null)}
        >
          <div
            className="bg-white rounded-[35px] max-w-xl w-full overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative h-60 bg-blue-900">
              <button
                type="button"
                onClick={() => setViewerSrc(eventImage(viewingDetailsEvent))}
                className="block w-full h-full group"
                aria-label="View full photo"
              >
                <img
                  src={eventImage(viewingDetailsEvent)}
                  alt={viewingDetailsEvent.event_name}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-3 right-3 px-3 py-1 bg-black/60 text-white text-[11px] font-bold rounded-full">
                  Tap to view full photo
                </span>
              </button>
              <button
                onClick={() => setViewingDetailsEvent(null)}
                className="absolute top-4 left-4 bg-black/60 hover:bg-black text-white px-3.5 py-1.5 rounded-full text-xs font-bold transition-all"
              >
                &larr; Back to schedule
              </button>
            </div>

            <div className="p-8 space-y-4">
              <span className={`inline-block px-3 py-1 text-[10px] font-black rounded-full ${phaseBadge[getPhase(viewingDetailsEvent.status)]}`}>
                {getPhase(viewingDetailsEvent.status)}
              </span>

              <h2 className="text-2xl font-black text-gray-900 leading-tight">{viewingDetailsEvent.event_name}</h2>

              <p className="text-sm text-gray-600 leading-relaxed">
                {viewingDetailsEvent.description || "No full description provided for this municipal activity."}
              </p>

              <div className="bg-blue-50/60 p-4 rounded-2xl text-xs space-y-2 border border-blue-100 font-medium text-gray-700">
                <p><strong>Organizer / Host:</strong> {viewingDetailsEvent.organizer_name || "N/A"}</p>
                <p><strong>Venue:</strong> {viewingDetailsEvent.venue || "N/A"}</p>
                <p><strong>Date:</strong> {formatLongDate(viewingDetailsEvent.event_date || viewingDetailsEvent.date)}</p>
                {viewingDetailsEvent.event_time && <p><strong>Time:</strong> {viewingDetailsEvent.event_time}</p>}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={(e) => {
                    const ev = viewingDetailsEvent;
                    setViewingDetailsEvent(null);
                    handleParticipateClick(e, ev);
                  }}
                  className={`flex-1 py-3 font-bold rounded-xl text-xs transition-all ${
                    myRegisteredIds.includes(String(viewingDetailsEvent.id))
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {myRegisteredIds.includes(String(viewingDetailsEvent.id)) ? "Registered \u2713" : "Join this event"}
                </button>
                <button
                  onClick={() => setViewingDetailsEvent(null)}
                  className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: PARTICIPATION REGISTRATION FORM --- */}
      {participatingEvent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[35px] max-w-lg w-full p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div>
              <button
                type="button"
                onClick={() => setParticipatingEvent(null)}
                className="text-xs font-bold text-blue-600 hover:text-blue-800 mb-3"
              >
                &larr; Back to schedule
              </button>
              <span className="block text-[10px] font-black text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full uppercase tracking-wider w-fit">
                Event Participation Form
              </span>
              <h2 className="text-2xl font-black text-gray-900 mt-2">Join {participatingEvent.event_name}</h2>
              <p className="text-xs text-gray-500 mt-1">
                Please complete your personal details to finalize event participation.
              </p>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-4 text-xs font-semibold">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">FIRST NAME *</label>
                  <input
                    type="text"
                    required
                    value={regForm.firstName}
                    onChange={(e) => setRegForm({ ...regForm, firstName: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">LAST NAME *</label>
                  <input
                    type="text"
                    required
                    value={regForm.lastName}
                    onChange={(e) => setRegForm({ ...regForm, lastName: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-gray-600 mb-1">GENDER *</label>
                  <select
                    value={regForm.gender}
                    onChange={(e) => setRegForm({ ...regForm, gender: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">AGE *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="120"
                    value={regForm.age}
                    onChange={(e) => setRegForm({ ...regForm, age: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">CIVIL STATUS *</label>
                  <select
                    value={regForm.civilStatus}
                    onChange={(e) => setRegForm({ ...regForm, civilStatus: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Widowed">Widowed</option>
                    <option value="Separated">Separated</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-gray-600 mb-1">HOME ADDRESS *</label>
                <input
                  type="text"
                  required
                  placeholder="Street, Barangay, City/Municipality"
                  value={regForm.homeAddress}
                  onChange={(e) => setRegForm({ ...regForm, homeAddress: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">PHONE NUMBER *</label>
                  <input
                    type="tel"
                    required
                    placeholder="09XXXXXXXXX"
                    value={regForm.phoneNumber}
                    onChange={(e) => setRegForm({ ...regForm, phoneNumber: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">EMAIL ADDRESS *</label>
                  <input
                    type="email"
                    required
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={submittingReg}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all"
                >
                  {submittingReg ? "Submitting..." : "Confirm & Register"}
                </button>
                <button
                  type="button"
                  onClick={() => setParticipatingEvent(null)}
                  className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 3: AUTH REQUIRED PROMPT --- */}
      {authRequiredEvent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <div className="space-y-2">
              <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-3 py-1 rounded-full uppercase">
                Account Required
              </span>
              <h3 className="text-xl font-bold text-gray-900">Join "{authRequiredEvent.event_name}"</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                To participate in this event, please log in or create a tourist account. Verified accounts can complete event registration forms.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => router.push("/login")}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 transition-all"
              >
                Log In to Account
              </button>
              <button
                onClick={() => router.push("/register")}
                className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-bold text-xs hover:bg-blue-100 transition-all"
              >
                Register New Account
              </button>
              <button
                onClick={() => setAuthRequiredEvent(null)}
                className="text-xs text-gray-400 font-bold pt-2 hover:text-gray-600 text-center"
              >
                &larr; Back to schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Event photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}

      {/* Footer */}
      <p className="text-center text-gray-400 text-[10px] mt-8 uppercase font-bold tracking-widest">
        Connect-Daet Tourism Management System v1.0
      </p>
    </div>
  );
}