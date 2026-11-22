"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Button from "@/components/ui/Button";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useFeedback } from "@/components/ui/Feedback";
import { FilePicker } from "@/components/ui/Attachments";
import { ImageCarousel } from "@/components/ui/ImageCarousel";
import EventCalendar from "@/components/ui/EventCalendar";
import { uploadAttachments, validateFiles, peso, getImageList } from "@/lib/eventHelpers";
import {
  withLiveStatus,
  useNow,
  formatTimeRange,
  loadInterested,
  saveInterested,
  msUntilStart,
  DAY_MS,
  regTypeOf,
} from "@/lib/eventSchedule";

const DEFAULT_EVENT_IMAGE =
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80";

const PUBLIC_STATUSES = ["approved", "upcoming", "ongoing", "completed", "cancellation requested", "rescheduled"];
const norm = (s) => (s || "").trim().toLowerCase();

const getPhase = (status) => {
  const s = norm(status);
  if (s === "ongoing") return "Ongoing";
  if (s === "completed") return "Completed";
  if (s === "rescheduled") return "Rescheduled";
  return "Upcoming";
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

// Helper for rendering date range cleanly on program cards and details
const formatEventDateRange = (startDateStr, endDateStr) => {
  const startFormatted = formatLongDate(startDateStr);
  if (!endDateStr || endDateStr === startDateStr) {
    return startFormatted;
  }
  const endFormatted = formatLongDate(endDateStr);
  return `${startFormatted} – ${endFormatted}`;
};

const phaseBadge = {
  Upcoming: "bg-blue-900 text-white",
  Ongoing: "bg-emerald-600 text-white",
  Completed: "bg-gray-700 text-white",
  Rescheduled: "bg-amber-600 text-white",
};

export default function ProgramsPage() {
  const router = useRouter();
  const { notify, feedbackUI } = useFeedback();

  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  const [rawEvents, setEvents] = useState([]);
  const now = useNow(30000);
  const events = useMemo(() => rawEvents.map((e) => withLiveStatus(e, now)), [rawEvents, now]);
  
  const [registrations, setRegistrations] = useState([]);
  const [interestedEvents, setInterestedEvents] = useState([]);
  const [fetchingEvents, setFetchingEvents] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");
  const [scheduleView, setScheduleView] = useState("list"); // "list" | "calendar"
  const [search, setSearch] = useState("");

  const [viewingDetailsEvent, setViewingDetailsEvent] = useState(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [participatingEvent, setParticipatingEvent] = useState(null);
  const [authRequiredEvent, setAuthRequiredEvent] = useState(null);
  const [viewerSrc, setViewerSrc] = useState(null);

  const [myRegisteredIds, setMyRegisteredIds] = useState([]);
  const [myRegStatus, setMyRegStatus] = useState({});

  const [payForm, setPayForm] = useState({ method: "cash", reference: "" });
  const [proofFile, setProofFile] = useState([]);
  const [qrUrl, setQrUrl] = useState(null);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [acceptedTC, setAcceptedTC] = useState(false);

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

  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState([]);
  const [interestBusy, setInterestBusy] = useState(null);

  const OFFICIAL_ADMIN_EMAIL = "admin.daet@gmail.com";

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

  useEffect(() => {
    if (!user?.id) {
      setMyRegisteredIds([]);
      setMyRegStatus({});
      setInterestedEvents([]);
      return;
    }

    supabase
      .from("event_registrations")
      .select("event_id, registration_status")
      .eq("user_id", user.id)
      .then(({ data }) => {
        setMyRegisteredIds((data || []).map((r) => String(r.event_id)));
        const map = {};
        (data || []).forEach((r) => {
          map[String(r.event_id)] = r.registration_status || "Confirmed";
        });
        setMyRegStatus(map);
      });

    const loadInterestedEvents = async () => {
      const { data, error } = await supabase.from("interested_events").select("event_id").eq("user_id", user.id);
      if (error) {
        setInterestedEvents(loadInterested(user.id));
        return;
      }
      let ids = (data || []).map((r) => String(r.event_id));

      const local = loadInterested(user.id).filter((id) => !ids.includes(id));
      if (local.length > 0) {
        const { error: importError } = await supabase
          .from("interested_events")
          .upsert(local.map((id) => ({ user_id: user.id, event_id: id })), { onConflict: "user_id,event_id", ignoreDuplicates: true });
        if (!importError) {
          ids = [...ids, ...local];
          saveInterested(user.id, []);
        }
      }
      setInterestedEvents(ids);
    };
    loadInterestedEvents();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || events.length === 0 || interestedEvents.length === 0) return;
    const due = events.filter((ev) => {
      if (!interestedEvents.includes(String(ev.id))) return false;
      const phase = getPhase(ev.status);
      if (phase === "Completed") return false;
      if (phase === "Ongoing") return true;
      const diff = msUntilStart(ev, new Date());
      return diff !== null && diff > 0 && diff <= DAY_MS;
    });
    if (due.length === 0) return;

    const seenKey = `daet:reminded:${user.id}`;
    let seen = [];
    try {
      seen = JSON.parse(window.sessionStorage.getItem(seenKey) || "[]");
    } catch {
      seen = [];
    }
    const fresh = due.filter((ev) => !seen.includes(String(ev.id)));
    if (fresh.length === 0) return;
    try {
      window.sessionStorage.setItem(seenKey, JSON.stringify([...seen, ...fresh.map((ev) => String(ev.id))]));
    } catch {
    }
    notify(
      fresh.length === 1
        ? `Reminder: "${fresh[0].event_name}" ${getPhase(fresh[0].status) === "Ongoing" ? "is happening now." : "starts within the next day."}`
        : `Reminder: ${fresh.length} events you are interested in start within the next day.`,
      "info"
    );
  }, [user?.id, events, interestedEvents]);

  const fetchEvents = async (silent = false) => {
    if (!silent) setFetchingEvents(true);
    try {
      const [evRes, regRes] = await Promise.all([
        supabase.from("tourism_programs").select("*").order("created_at", { ascending: false }),
        supabase.from("event_registrations").select("event_id, registration_status")
      ]);

      if (evRes.error) throw evRes.error;
      setEvents((evRes.data || []).filter((e) => PUBLIC_STATUSES.includes(norm(e.status))));
      setRegistrations(regRes.data || []);
    } catch (error) {
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserProfile(null);
    router.push("/programs");
  };

  const isAdmin =
    user && (user.email?.toLowerCase() === OFFICIAL_ADMIN_EMAIL.toLowerCase() || userProfile?.role === "admin");

  const getConfirmedCount = (eventId) => {
    return registrations.filter((r) => String(r.event_id) === String(eventId) && (r.registration_status === "Confirmed" || r.registration_status === "Pending")).length;
  };

  const toggleInterest = async (e, eventId) => {
    e?.stopPropagation?.();
    if (!user) {
      notify("Please log in to mark events as interested.");
      return;
    }
    const key = String(eventId);
    if (interestBusy === key) return;
    const isAlready = interestedEvents.includes(key);
    setInterestBusy(key);

    try {
      if (isAlready) {
        const { error } = await supabase.from("interested_events").delete().eq("user_id", user.id).eq("event_id", eventId);
        if (error) throw error;
        setInterestedEvents((prev) => prev.filter((id) => id !== key));
        notify("Removed from your interested list.", "info");
      } else {
        const { error } = await supabase.from("interested_events").insert([{ user_id: user.id, event_id: eventId }]);
        if (error && error.code !== "23505") throw error;
        setInterestedEvents((prev) => (prev.includes(key) ? prev : [...prev, key]));
        if (isAdmin || userProfile?.role === "organizer") {
          notify("Saved to your interested list.", "info");
        } else {
          notify("Marked as interested! You will get a reminder in your Tourist Portal 1 day before the event.");
        }
      }
    } catch (err) {
      notify("Could not update your interest: " + (err.message || "Unknown error"));
    } finally {
      setInterestBusy(null);
    }
  };

  const handleParticipateClick = (e, event) => {
    e?.stopPropagation?.();
    if (regTypeOf(event) === "interested") {
      toggleInterest(e, event.id);
      return;
    }
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
      const st = norm(myRegStatus[String(event.id)]) || "confirmed";
      notify(
        st === "pending"
          ? "Your registration is pending until the organizer confirms your payment. You can follow it in your Tourist Portal."
          : st === "rejected"
          ? "Your registration was rejected. Open your Tourist Portal to resubmit it."
          : "You are already registered for this event. You can review it in your Tourist Portal.",
        "info"
      );
    } else {
      const max = event.max_slots ? parseInt(event.max_slots, 10) : null;
      const current = getConfirmedCount(event.id);
      if (max !== null && current >= max) {
        notify("The quota limit for this event has been reached. Registration is now closed.", "info");
        return;
      }
      openRegistration(event);
    }
  };

  const openRegistration = (event) => {
    setPayForm({ method: "cash", reference: "" });
    setProofFile([]);
    setQrUrl(null);
    setAcceptedTC(false);
    setTeamName("");
    if (regTypeOf(event) === "group") {
      const others = Math.max(0, (parseInt(event.team_size, 10) || 2) - 1);
      setTeamMembers(
        Array.from({ length: others }, () => ({ firstName: "", lastName: "", gender: "Male", age: "", homeAddress: "", phoneNumber: "" }))
      );
    } else {
      setTeamMembers([]);
    }
    setActiveImageIdx(0);
    setParticipatingEvent(event);
  };

  const updateMember = (i, patch) => setTeamMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const handleGenerateQR = async () => {
    setGeneratingQR(true);
    try {
      const res = await fetch("/api/create-qrph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: participatingEvent.fee_amount, description: participatingEvent.event_name }),
      });
      const data = await res.json();
      if (data.success) {
        setQrUrl(data.qrImageUrl);
      } else {
        notify("Failed to generate QR code: " + data.error);
      }
    } catch (e) {
      notify("Error: " + e.message);
    }
    setGeneratingQR(false);
  };

  const regInfo = (eventId) => {
    const key = String(eventId);
    if (!myRegisteredIds.includes(key)) return null;
    const st = norm(myRegStatus[key]) || "confirmed";
    if (st === "pending") return { label: "Pending approval", cls: "bg-amber-100 text-amber-800" };
    if (st === "rejected") return { label: "Rejected - open portal", cls: "bg-red-100 text-red-700" };
    return { label: "Registered ✓", cls: "bg-emerald-100 text-emerald-800" };
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!acceptedTC) {
      return notify("You must read and agree to the Terms and Conditions before registering.");
    }
    setSubmittingReg(true);

    try {
      const max = participatingEvent.max_slots ? parseInt(participatingEvent.max_slots, 10) : null;
      const current = getConfirmedCount(participatingEvent.id);
      if (max !== null && current >= max) {
        notify("The quota limit for this event has been reached. Registration is now closed.", "info");
        setParticipatingEvent(null);
        return;
      }

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

      const paid = !!participatingEvent.is_paid;
      const method = payForm.method === "online" ? "Online" : "Cash";

      if (paid && method === "Online" && !payForm.reference.trim() && proofFile.length === 0) {
        notify("For online payments, please enter your payment reference number or attach a screenshot of your receipt.");
        setSubmittingReg(false);
        return;
      }
      const proofError = validateFiles(proofFile);
      if (paid && proofError) {
        notify(proofError);
        setSubmittingReg(false);
        return;
      }

      const isGroup = regTypeOf(participatingEvent) === "group";
      let teamPayload = {};
      if (isGroup) {
        if (!teamName.trim()) {
          notify("Please enter your team / group name.");
          setSubmittingReg(false);
          return;
        }
        for (let i = 0; i < teamMembers.length; i += 1) {
          const m = teamMembers[i];
          if (!m.firstName.trim() || !m.lastName.trim() || !m.age || !m.homeAddress.trim()) {
            notify(`Please complete the name, age and address of member ${i + 2}.`);
            setSubmittingReg(false);
            return;
          }
        }

        teamPayload = {
          team_name: teamName.trim(),
          team_members: [
            {
              first_name: regForm.firstName.trim(),
              last_name: regForm.lastName.trim(),
              gender: regForm.gender,
              age: parseInt(regForm.age, 10),
              civil_status: regForm.civilStatus,
              home_address: regForm.homeAddress.trim(),
              phone_number: regForm.phoneNumber.trim(),
              email: regForm.email.trim(),
            },
            ...teamMembers.map((m) => ({
              first_name: m.firstName.trim(),
              last_name: m.lastName.trim(),
              gender: m.gender,
              age: parseInt(m.age, 10),
              home_address: m.homeAddress.trim(),
              phone_number: m.phoneNumber.trim() || null,
            })),
          ],
        };
      }

      let proofUrl = null;
      if (paid && method === "Online" && proofFile.length > 0) {
        const [uploaded] = await uploadAttachments(proofFile, `payment-proofs/${user.id}`);
        proofUrl = uploaded.url;
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
          registration_status: paid ? "Pending" : "Confirmed",
          payment_method: paid ? method : null,
          payment_reference: paid && method === "Online" ? payForm.reference.trim() || null : null,
          payment_proof_url: proofUrl,
          amount_due: paid ? participatingEvent.fee_amount : null,
          ...teamPayload,
        },
      ]);

      if (error) throw error;

      setMyRegisteredIds((prev) => [...new Set([...prev, String(participatingEvent.id)])]);
      setMyRegStatus((prev) => ({ ...prev, [String(participatingEvent.id)]: paid ? "Pending" : "Confirmed" }));
      setParticipatingEvent(null);
      if (paid) {
        notify(
          "Registration submitted. It stays pending until the organizer confirms your payment - you will see the result in your Tourist Portal.",
          "info"
        );
      } else {
        notify("Registration successful!");
      }
      fetchEvents(true);
    } catch (err) {
      console.error("Registration submission error:", err);
      notify("Error submitting registration: " + err.message);
    } finally {
      setSubmittingReg(false);
    }
  };

  const isGroupReg = !!participatingEvent && regTypeOf(participatingEvent) === "group";

  const visibleEvents = useMemo(() => {
    const rank = { Ongoing: 0, Upcoming: 1, Rescheduled: 2, Completed: 3 };
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
    const c = { All: events.length, Upcoming: 0, Ongoing: 0, Rescheduled: 0, Completed: 0 };
    events.forEach((e) => {
      if (c[getPhase(e.status)] !== undefined) {
        c[getPhase(e.status)] += 1;
      }
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

  const getImages = (ev) => {
    if (Array.isArray(ev?.image_url) && ev.image_url.length > 0) {
      return ev.image_url.map(u => getImageList(u)[0]).filter(Boolean);
    }
    if (Array.isArray(ev?.image_urls) && ev.image_urls.length > 0) {
      return ev.image_urls.map(u => getImageList(u)[0]).filter(Boolean);
    }
    const parsed = getImageList(ev?.image_url || ev?.image_urls);
    if (parsed.length > 0) return parsed;
    return [DEFAULT_EVENT_IMAGE];
  };

  return (
    <div className="daet-ui max-w-6xl mx-auto py-8 px-4 space-y-10">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-gray-100 pb-6">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Tourism programs and events</h1>
          <p className="text-xs text-gray-500 font-semibold mt-0.5">Verified by the Municipal Tourism Office of Daet</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <>
              {isAdmin ? (
                <Link href="/admin">
                  <button className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white font-bold rounded-xl text-xs transition-all shadow-sm">
                    ← Back to Admin Control Center
                  </button>
                </Link>
              ) : userProfile?.role === "organizer" ? (
                <Link href="/organizer/dashboard">
                  <Button variant="primary" className="text-xs py-2 px-4 bg-blue-900 hover:bg-blue-800 border-none">
                    ← Back to Organizer Dashboard
                  </Button>
                </Link>
              ) : (
                <Link href="/tourist/dashboard">
                  <button className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                    Open Tourist Portal →
                  </button>
                </Link>
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
                <Button variant="secondary" className="text-xs py-2 px-5 text-blue-900 border-blue-900 hover:bg-blue-50">
                  Log In
                </Button>
              </Link>
              <Link href="/register">
                <button className="px-5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-md transition-all">
                  Register Account
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 text-white shadow-xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
          <div className="lg:col-span-3 p-8 md:p-12 flex flex-col justify-center space-y-6">
            <div className="space-y-3">
              <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tight leading-[1.1]">
                Festivals, fiestas and activities across Daet
              </h2>
              <p className="text-blue-100 text-sm leading-relaxed max-w-lg">
                Browse every verified event, check attendee quotas, and sign up with a tourist account when you are ready to join.
              </p>
            </div>

            <div className="relative max-w-md">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by event, venue or organizer"
                className="w-full pl-4 pr-4 py-3.5 rounded-2xl bg-white text-gray-800 text-sm placeholder:text-gray-400 shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-400/40"
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
                    Submit Event Proposal →
                  </button>
                </Link>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 p-6 md:p-8 lg:pl-0 flex items-center">
            {featuredEvent ? (
              <div className="w-full bg-white rounded-2xl overflow-hidden shadow-xl text-gray-900">
                <ImageCarousel 
                  images={getImages(featuredEvent)} 
                  onPreview={setViewerSrc} 
                  className="aspect-[16/9] w-full" 
                />
                <div className="p-5 space-y-2">
                  <span className={`inline-block px-2.5 py-0.5 text-[10px] font-black rounded-full ${phaseBadge[getPhase(featuredEvent.status)]}`}>
                    {getPhase(featuredEvent.status) === "Ongoing" ? "Happening now" : "Next up"}
                  </span>
                  <h3 className="text-lg font-black text-blue-900 leading-snug">{featuredEvent.event_name}</h3>
                  <p className="text-xs text-gray-500 font-medium">
                    {formatEventDateRange(featuredEvent.event_date || featuredEvent.date, featuredEvent.end_date)}{formatTimeRange(featuredEvent) ? ` · ${formatTimeRange(featuredEvent)}` : ""} · {featuredEvent.venue || "Venue to be announced"}
                  </p>
                  <button
                    onClick={() => setViewingDetailsEvent(featuredEvent)}
                    className="mt-2 w-full py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    See details
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full rounded-2xl border border-white/20 bg-white/10 p-8 text-center text-blue-100 text-sm">
                No upcoming events are listed yet. Check back soon.
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="public-schedule" className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 pb-4">
          <div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Official Event Schedule</h2>
            <p className="text-xs font-semibold text-gray-500 mt-0.5">
              {scheduleView === "calendar"
                ? `Viewing 1-year official schedule (${events.length} verified ${events.length === 1 ? "event" : "events"})`
                : `Showing ${visibleEvents.length} verified ${visibleEvents.length === 1 ? "event" : "events"}${
                    search.trim() ? ` matching "${search.trim()}"` : ""
                  }`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {scheduleView === "list" && (
              <div className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-2xl border border-gray-200" role="tablist" aria-label="Filter events by status">
                {["All", "Upcoming", "Ongoing", "Rescheduled", "Completed"].map((filter) => (
                  <button
                    key={filter}
                    role="tab"
                    aria-selected={activeFilter === filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all ${
                      activeFilter === filter ? "bg-blue-900 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {filter} <span className={activeFilter === filter ? "text-blue-100 font-semibold" : "text-gray-400 font-semibold"}>{counts[filter]}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="inline-flex bg-slate-100 p-1.5 rounded-2xl border border-gray-200">
              <button
                type="button"
                onClick={() => setScheduleView("list")}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  scheduleView === "list" ? "bg-white text-blue-900 shadow-sm" : "text-gray-600 hover:text-slate-900"
                }`}
              >
                Card List
              </button>
              <button
                type="button"
                onClick={() => setScheduleView("calendar")}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  scheduleView === "calendar" ? "bg-blue-900 text-white shadow-sm" : "text-gray-600 hover:text-slate-900"
                }`}
              >
                1-Year Calendar
              </button>
            </div>
          </div>
        </div>

        {fetchingEvents && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl bg-white border border-gray-100 overflow-hidden animate-pulse">
                <div className="aspect-[16/9] bg-gray-100" />
                <div className="p-6 space-y-3">
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!fetchingEvents && scheduleView === "calendar" && (
          <EventCalendar
            events={events}
            role="guest"
            onSelectEvent={(ev) => {
              setActiveImageIdx(0);
              setViewingDetailsEvent(ev);
            }}
          />
        )}

        {!fetchingEvents && scheduleView === "list" && visibleEvents.length === 0 && (
          <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-gray-200 space-y-3">
            <p className="text-sm font-bold text-gray-500">
              {search.trim() || activeFilter !== "All"
                ? "No events match these filters."
                : "No events are scheduled right now."}
            </p>
            {(search.trim() || activeFilter !== "All") && (
              <button
                onClick={() => { setSearch(""); setActiveFilter("All"); }}
                className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-xl text-xs font-bold transition-all"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {!fetchingEvents && scheduleView === "list" && visibleEvents.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleEvents.map((item) => {
              const phase = getPhase(item.status);
              const date = parseDate(item.event_date || item.date);
              const imgs = getImages(item);
              const max = item.max_slots !== null && item.max_slots !== undefined && item.max_slots !== "" ? parseInt(item.max_slots, 10) : null;
              const confirmed = getConfirmedCount(item.id);
              const remaining = max !== null ? Math.max(0, max - confirmed) : null;
              const isFull = max !== null && remaining === 0;
              const isInterested = interestedEvents.includes(String(item.id));
              const regType = regTypeOf(item);
              const isInterestOnly = regType === "interested";
              const isGroup = regType === "group";
              const isFreeWithoutLimit = isInterestOnly || (!item.is_paid && max === null && !isGroup);

              return (
                <article
                  key={item.id}
                  onClick={() => { setActiveImageIdx(0); setViewingDetailsEvent(item); }}
                  className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer flex flex-col"
                >
                  <div className="relative aspect-[16/9] w-full bg-blue-900 overflow-hidden group">
                    <ImageCarousel 
                      images={imgs} 
                      onPreview={setViewerSrc} 
                      className="absolute inset-0 w-full h-full" 
                    />

                    {date && (
                      <div className="absolute top-3 left-3 bg-white rounded-2xl px-3 py-1.5 text-center shadow-md leading-none pointer-events-none z-20">
                        <div className="text-[10px] font-bold text-blue-900">{date.toLocaleDateString(undefined, { month: "short" })}</div>
                        <div className="text-xl font-black text-blue-900">{date.getDate()}</div>
                      </div>
                    )}

                    <span className={`absolute top-3 right-3 text-[10px] font-black px-3 py-1 rounded-full pointer-events-none z-20 ${phaseBadge[phase]}`}>
                      {phase}
                    </span>

                    {!isInterestOnly && (
                    <button
                      onClick={(e) => toggleInterest(e, item.id)}
                      className={`absolute bottom-3 left-3 px-3 py-1 rounded-full text-xs font-bold shadow-lg transition-all z-20 ${
                        isInterested ? "bg-red-500 text-white" : "bg-white/90 text-gray-700 hover:bg-white"
                      }`}
                      title="Mark as Interested (receive 1-day reminder)"
                    >
                      {isInterested ? "★ Interested" : "☆ Interested"}
                    </button>
                    )}
                  </div>

                  <div className="p-5 space-y-2 flex-grow">
                    <h3 className="font-black text-gray-900 text-lg leading-snug">{item.event_name}</h3>
                    <p className="text-gray-500 text-xs leading-relaxed line-clamp-2">
                      {item.description || "No description provided."}
                    </p>

                    {isInterestOnly && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-100 text-sky-800">No registration needed</span>
                      </div>
                    )}
                    {!isFreeWithoutLimit && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {isGroup && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-100 text-indigo-800">
                            Teams of {item.team_size || "?"}
                          </span>
                        )}
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${item.is_paid ? "bg-purple-100 text-purple-800" : "bg-emerald-100 text-emerald-800"}`}>
                          {item.is_paid ? `Paid: ${peso(item.fee_amount)}${isGroup ? " per team" : ""}` : "Free"}
                        </span>
                        {max !== null && (
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${isFull ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}`}>
                            {isFull ? "Quota Full" : isGroup ? `${remaining} team spots remaining` : `${remaining} slots remaining`}
                          </span>
                        )}
                      </div>
                    )}

                    <dl className="text-xs text-gray-600 space-y-1 pt-2 font-medium">
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Venue</dt><dd className="truncate">{item.venue || "To be announced"}</dd></div>
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Host</dt><dd className="truncate">{item.organizer_name || "Municipal Tourism Office"}</dd></div>
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Date</dt><dd>{formatEventDateRange(item.event_date || item.date, item.end_date)}</dd></div>
                      <div className="flex gap-2"><dt className="font-bold text-gray-800">Time</dt><dd>{formatTimeRange(item) || "To be announced"}</dd></div>
                    </dl>
                  </div>

                  <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-2">
                    {isInterestOnly ? (
                      <button
                        onClick={(e) => toggleInterest(e, item.id)}
                        disabled={phase === "Completed" || interestBusy === String(item.id)}
                        className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm disabled:cursor-not-allowed ${
                          phase === "Completed"
                            ? "bg-gray-200 text-gray-500"
                            : isInterested
                            ? "bg-red-500 hover:bg-red-600 text-white"
                            : "bg-blue-900 hover:bg-blue-800 text-white"
                        }`}
                      >
                        {phase === "Completed" ? "Event ended" : isInterested ? "★ Interested" : "☆ Interested"}
                      </button>
                    ) : (
                    <button
                      onClick={(e) => handleParticipateClick(e, item)}
                      disabled={phase === "Completed" || myRegisteredIds.includes(String(item.id)) || isFull}
                      className={`flex-1 py-2.5 disabled:cursor-not-allowed rounded-xl font-bold text-xs transition-all shadow-sm ${
                        regInfo(item.id)
                          ? regInfo(item.id).cls
                          : isFull
                          ? "bg-gray-200 text-gray-500"
                          : "bg-blue-900 hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-500 text-white"
                      }`}
                    >
                      {regInfo(item.id)
                        ? regInfo(item.id).label
                        : isFull
                        ? "Quota Full"
                        : phase === "Completed"
                        ? "Event ended"
                        : isGroup
                        ? item.is_paid
                          ? `Register a team - ${peso(item.fee_amount)}`
                          : "Register a team"
                        : item.is_paid
                        ? `Join - ${peso(item.fee_amount)}`
                        : "Join this event"}
                    </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveImageIdx(0);
                        setViewingDetailsEvent(item);
                      }}
                      className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-xl font-bold text-xs transition-all"
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

      {viewingDetailsEvent && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setViewingDetailsEvent(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full overflow-hidden shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative aspect-[16/9] bg-blue-900">
              <ImageCarousel 
                images={getImages(viewingDetailsEvent)} 
                onPreview={setViewerSrc} 
                className="absolute inset-0 w-full h-full" 
              />
              <button
                onClick={() => setViewingDetailsEvent(null)}
                className="absolute top-4 left-4 bg-black/60 hover:bg-black text-white px-3.5 py-1.5 rounded-full text-xs font-bold transition-all z-20"
              >
                ← Back to schedule
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
                <p><strong>Date:</strong> {formatEventDateRange(viewingDetailsEvent.event_date || viewingDetailsEvent.date, viewingDetailsEvent.end_date)}</p>
                {formatTimeRange(viewingDetailsEvent) && <p><strong>Time:</strong> {formatTimeRange(viewingDetailsEvent)}</p>}
                {regTypeOf(viewingDetailsEvent) === "interested" ? (
                  <p><strong>Registration:</strong> None needed. Tap Interested to let the organizer know you plan to come.</p>
                ) : (
                  <>
                    {regTypeOf(viewingDetailsEvent) === "group" && (
                      <p><strong>Registration:</strong> Group - teams of {viewingDetailsEvent.team_size || "?"} members</p>
                    )}
                    <p>
                      <strong>{regTypeOf(viewingDetailsEvent) === "group" ? "Fee per team" : "Participation fee"}:</strong>{" "}
                      {viewingDetailsEvent.is_paid ? peso(viewingDetailsEvent.fee_amount) : "Free"}
                    </p>
                    {viewingDetailsEvent.max_slots && (
                      <p>
                        <strong>{regTypeOf(viewingDetailsEvent) === "group" ? "Team spots" : "Attendee Quota Limit"}:</strong>{" "}
                        {viewingDetailsEvent.max_slots} {regTypeOf(viewingDetailsEvent) === "group" ? "teams" : "slots"}
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                {regTypeOf(viewingDetailsEvent) === "interested" ? (
                  <button
                    onClick={(e) => toggleInterest(e, viewingDetailsEvent.id)}
                    disabled={getPhase(viewingDetailsEvent.status) === "Completed" || interestBusy === String(viewingDetailsEvent.id)}
                    className={`flex-1 py-3 font-bold rounded-xl text-xs transition-all disabled:cursor-not-allowed ${
                      getPhase(viewingDetailsEvent.status) === "Completed"
                        ? "bg-gray-200 text-gray-500"
                        : interestedEvents.includes(String(viewingDetailsEvent.id))
                        ? "bg-red-500 hover:bg-red-600 text-white"
                        : "bg-blue-900 hover:bg-blue-800 text-white"
                    }`}
                  >
                    {getPhase(viewingDetailsEvent.status) === "Completed"
                      ? "Event ended"
                      : interestedEvents.includes(String(viewingDetailsEvent.id))
                      ? "★ Interested"
                      : "☆ Interested"}
                  </button>
                ) : (
                <button
                  onClick={(e) => {
                    const ev = viewingDetailsEvent;
                    setViewingDetailsEvent(null);
                    handleParticipateClick(e, ev);
                  }}
                  className={`flex-1 py-3 font-bold rounded-xl text-xs transition-all shadow-sm ${
                    regInfo(viewingDetailsEvent.id) ? regInfo(viewingDetailsEvent.id).cls : "bg-blue-900 text-white hover:bg-blue-800"
                  }`}
                >
                  {regInfo(viewingDetailsEvent.id)
                    ? regInfo(viewingDetailsEvent.id).label
                    : regTypeOf(viewingDetailsEvent) === "group"
                    ? "Register a team"
                    : "Join this event"}
                </button>
                )}
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

      {participatingEvent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`bg-white rounded-2xl ${isGroupReg ? "max-w-2xl" : "max-w-lg"} w-full p-8 shadow-xl space-y-6 max-h-[90vh] overflow-y-auto`}>
            <div>
              <button
                type="button"
                onClick={() => setParticipatingEvent(null)}
                className="text-xs font-bold text-blue-900 hover:bg-blue-800 mb-3"
              >
                ← Back to schedule
              </button>
              <span className="block text-[10px] font-black text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full uppercase tracking-wider w-fit">
                {isGroupReg ? "Team Registration Form" : "Event Participation Form"}
              </span>
              <h2 className="text-2xl font-black text-gray-900 mt-2">
                {isGroupReg ? "Register a team for" : "Join"} {participatingEvent.event_name}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {isGroupReg
                  ? `Enter your team name, then the details of all ${participatingEvent.team_size || ""} members. You are the team leader.`
                  : "Please complete your personal details to finalize event participation."}
              </p>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-4 text-xs font-semibold">
              {isGroupReg && (
                <>
                  <div>
                    <label className="block text-gray-600 mb-1">TEAM / GROUP NAME *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Daet Dragons"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                  <p className="text-[10px] font-black text-blue-900 uppercase tracking-wider pt-1">Member 1 - Team leader (you)</p>
                </>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">FIRST NAME *</label>
                  <input
                    type="text"
                    required
                    value={regForm.firstName}
                    onChange={(e) => setRegForm({ ...regForm, firstName: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">LAST NAME *</label>
                  <input
                    type="text"
                    required
                    value={regForm.lastName}
                    onChange={(e) => setRegForm({ ...regForm, lastName: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-gray-600 mb-1">GENDER *</label>
                  <select
                    value={regForm.gender}
                    onChange={(e) => setRegForm({ ...regForm, gender: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
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
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">CIVIL STATUS *</label>
                  <select
                    value={regForm.civilStatus}
                    onChange={(e) => setRegForm({ ...regForm, civilStatus: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
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
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
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
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">EMAIL ADDRESS *</label>
                  <input
                    type="email"
                    required
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>
              </div>

              {isGroupReg && (
                <>
                  {teamMembers.map((m, i) => (
                    <div key={i} className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                      <p className="text-[10px] font-black text-blue-900 uppercase tracking-wider">Member {i + 2}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-gray-600 mb-1">FIRST NAME *</label>
                          <input type="text" required value={m.firstName} onChange={(e) => updateMember(i, { firstName: e.target.value })} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900" />
                        </div>
                        <div>
                          <label className="block text-gray-600 mb-1">LAST NAME *</label>
                          <input type="text" required value={m.lastName} onChange={(e) => updateMember(i, { lastName: e.target.value })} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-gray-600 mb-1">GENDER *</label>
                          <select value={m.gender} onChange={(e) => updateMember(i, { gender: e.target.value })} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900">
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-gray-600 mb-1">AGE *</label>
                          <input type="number" required min="1" max="120" value={m.age} onChange={(e) => updateMember(i, { age: e.target.value })} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-gray-600 mb-1">HOME ADDRESS *</label>
                        <input type="text" required placeholder="Street, Barangay, City/Municipality" value={m.homeAddress} onChange={(e) => updateMember(i, { homeAddress: e.target.value })} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900" />
                      </div>
                      <div>
                        <label className="block text-gray-600 mb-1">PHONE NUMBER (optional)</label>
                        <input type="tel" placeholder="09XXXXXXXXX" value={m.phoneNumber} onChange={(e) => updateMember(i, { phoneNumber: e.target.value })} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900" />
                      </div>
                    </div>
                  ))}
                </>
              )}

              {participatingEvent.is_paid && (
                <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 uppercase">{isGroupReg ? "Registration fee (per team)" : "Registration fee"}</span>
                    <span className="text-lg font-black text-blue-900">{peso(participatingEvent.fee_amount)}</span>
                  </div>

                  <div>
                    <label className="block text-gray-600 mb-2">PAYMENT METHOD *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: "cash", label: "Cash" },
                        { value: "online", label: "Online QR Ph" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setPayForm({ ...payForm, method: opt.value }); setQrUrl(null); }}
                          className={`py-3 rounded-xl border-2 font-bold transition-all ${
                            payForm.method === opt.value
                              ? "border-blue-900 bg-white text-blue-900 shadow-sm"
                              : "border-gray-200 bg-white text-gray-500 hover:border-blue-300"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {payForm.method === "cash" && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Pay your cash here</p>
                      <p className="text-gray-800 whitespace-pre-line leading-relaxed">
                        {participatingEvent.cash_payment_details ||
                          "The organizer has not stated a cash payment location yet. Please contact the organizer before paying."}
                      </p>
                    </div>
                  )}

                  {payForm.method === "online" && (
                    <div className="space-y-4">
                      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 text-center">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Pay via QR Ph (GCash, Maya, Banks)</p>
                        {qrUrl ? (
                          <div className="space-y-2">
                            <img src={qrUrl} alt="QR Ph Code" className="w-48 h-48 mx-auto border border-gray-100 rounded-lg p-2" />
                            <p className="text-[10px] text-gray-500 font-medium">Scan using GCash, Maya, or any participating bank app to pay {peso(participatingEvent.fee_amount)}.</p>
                          </div>
                        ) : (
                          <button type="button" onClick={handleGenerateQR} disabled={generatingQR} className="px-6 py-2.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                            {generatingQR ? "Generating QR Code..." : "Generate QR Ph Code"}
                          </button>
                        )}
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Alternative Online Transfer Details</p>
                        <p className="text-gray-800 whitespace-pre-line leading-relaxed">
                          {participatingEvent.online_payment_details ||
                            "The organizer has not provided alternative direct bank details yet."}
                        </p>
                      </div>
                      <div>
                        <label className="block text-gray-600 mb-1">PAYMENT REFERENCE NO.</label>
                        <input
                          type="text"
                          placeholder="Reference number from your receipt"
                          value={payForm.reference}
                          onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                          className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-600 mb-1">RECEIPT SCREENSHOT (OPTIONAL)</label>
                        <FilePicker
                          files={proofFile}
                          onChange={setProofFile}
                          multiple={false}
                          accept="image/*"
                          label="Attach receipt photo"
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3 font-medium">
                    Your registration stays <strong>pending</strong> until the organizer confirms your payment. You will be notified in your Tourist Portal once it is approved.
                  </p>
                </div>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3 mt-4">
                <h4 className="font-black text-gray-900 text-sm">Connect-Daet Tourism Events: Registration & Payment Terms and Conditions</h4>
                <div className="h-32 overflow-y-auto text-[10px] text-gray-600 space-y-2 pr-2 font-medium bg-white p-3 rounded-lg border border-gray-100">
                  <p>By registering for any official event, festival, or municipal activity hosted through the Connect-Daet platform, you acknowledge that you have read, understood, and agreed to the following terms and conditions regarding event registration, fees, and cancellation policies.</p>
                  <p className="font-bold text-gray-800 pt-1">Acceptance of Terms</p>
                  <p>By submitting your event registration form and completing the registration process, you enter into a binding agreement with the Municipal Tourism Office of Daet and the designated event organizer. You agree to comply with all rules, guidelines, and schedules established for the event.</p>
                  <p className="font-bold text-gray-800 pt-1">2. Payment Terms</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li><strong>Payment Obligation:</strong> Certain events require a registration fee (paid via cash or approved online payment methods). Registrations for paid events remain in a Pending status until payment is verified and confirmed by the organizer.</li>
                    <li><strong>Accuracy of Information:</strong> You are solely responsible for providing accurate payment references, receipts, and personal details. Incorrect or fraudulent information may result in the rejection of your registration.</li>
                  </ul>
                  <p className="font-bold text-gray-800 pt-1">3. Strict Non-Refundable Payment Policy</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li><strong>All Sales Final:</strong> Once a payment has been successfully processed and your registration is confirmed, all fees paid are strictly non-refundable, regardless of the reason for cancellation, non-attendance, schedule changes, or inclement weather.</li>
                    <li><strong>No Chargebacks or Claims:</strong> Participants agree not to dispute or initiate chargebacks with financial institutions for non-refundable event fees.</li>
                  </ul>
                  <p className="font-bold text-gray-800 pt-1">4. Cancellation of Event Registration</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li><strong>Right to Cancel:</strong> You retain the right to cancel your event registration at any time through your Tourist Portal dashboard prior to the event completion date.</li>
                    <li><strong>Forfeiture of Fees:</strong> Cancelling your registration will remove you from the official attendee and participant lists. However, cancellation does not entitle you to a refund of any registration fees or payments previously made. All payments are permanently forfeited upon cancellation.</li>
                  </ul>
                  <p className="font-bold text-gray-800 pt-1">5. Event Modifications & Force Majeure</p>
                  <p>The Municipal Tourism Office of Daet and event organizers reserve the right to modify, postpone, or cancel events due to unforeseen circumstances, safety concerns, or force majeure events (such as severe weather, natural disasters, or public emergencies). In the event of a postponement or cancellation initiated by the organizer, alternative accommodations or rescheduling options may be provided at the organizer's discretion, but cash refunds remain strictly excluded.</p>
                </div>
                <label className="flex items-start gap-2 mt-2 cursor-pointer group">
                  <input type="checkbox" required checked={acceptedTC} onChange={(e) => setAcceptedTC(e.target.checked)} className="mt-0.5 accent-blue-900 w-4 h-4" />
                  <span className="text-[11px] font-bold text-gray-800 leading-tight group-hover:text-blue-900 transition-colors">
                    I have read, understood, and agree to the Terms and Conditions, including the strict non-refundable payment policy.
                  </span>
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={submittingReg}
                  className="w-full py-3.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm"
                >
                  {submittingReg ? "Submitting..." : participatingEvent.is_paid ? (isGroupReg ? "Submit Team Registration" : "Submit Registration") : isGroupReg ? "Confirm & Register Team" : "Confirm & Register"}
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

      {authRequiredEvent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full space-y-6 shadow-xl">
            <div className="space-y-2">
              <span className="text-[10px] font-black text-blue-900 bg-blue-50 px-3 py-1 rounded-full uppercase">
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
                className="w-full py-3 bg-blue-900 text-white rounded-xl font-bold text-xs hover:bg-blue-800 transition-all shadow-sm"
              >
                Log In to Account
              </button>
              <button
                onClick={() => router.push("/register")}
                className="w-full py-3 bg-blue-50 text-blue-900 rounded-xl font-bold text-xs hover:bg-blue-100 transition-all"
              >
                Register New Account
              </button>
              <button
                onClick={() => setAuthRequiredEvent(null)}
                className="text-xs text-gray-400 font-bold pt-2 hover:text-gray-600 text-center"
              >
                ← Back to schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerSrc && <ImageLightbox src={viewerSrc} alt="Event photo" onClose={() => setViewerSrc(null)} />}
      {feedbackUI}

      <p className="text-center text-gray-400 text-[10px] mt-8 uppercase font-bold tracking-widest">
        Connect-Daet Tourism Management System v1.0
      </p>
    </div>
  );
}