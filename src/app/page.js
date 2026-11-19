"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import SubmitProposalLink from "@/components/ui/SubmitProposalLink";
import { supabase } from "@/lib/supabase";
import { useFeedback } from "@/components/ui/Feedback";

const audiences = [
  {
    title: "Event organizers",
    text: "Submit event proposals, provide the necessary event details and track the status of every submission.",
    cta: "Submit an event proposal",
    href: "/programs/submit",
    smartLink: true,
  },
  {
    title: "Tourists",
    text: "Browse available tourism events and activities, view event information and join based on the registration requirements.",
    cta: "Browse events",
    href: "/programs",
  },
];

const steps = [
  { title: "Organizer submits a proposal", text: "Event details, a banner photo and whether the event is free or paid." },
  { title: "Tourism Office reviews it", text: "Administrators approve, request changes or reject the proposal." },
  { title: "Requirements are completed", text: "If needed, an approval letter is sent and the organizer replies with the required documents." },
  { title: "Event is published", text: "Approved events appear on the public schedule for everyone to see." },
  { title: "Tourists register", text: "Free events confirm right away. Paid events wait for the organizer to confirm payment." },
];

export default function Home() {
  const { notify, feedbackUI } = useFeedback();
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
    }
    checkUser();
  }, []);

  const handleCreateAccountClick = (e) => {
    if (user) {
      e.preventDefault();
      notify("unable to create an account you have already made an account");
    }
  };

  return (
    <main className="font-sans">
      <section className="bg-gradient-to-br from-[#0a1733] to-blue-950 text-white overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 md:py-28 flex flex-col items-center text-center">
          <div className="space-y-6 sm:space-y-8 z-10">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1] text-white">
              Daet Tourism Programs & Events System
            </h1>
            <p className="text-base sm:text-lg text-blue-100/90 leading-relaxed max-w-2xl mx-auto font-medium">
              A centralized web platform designed for the Municipal Tourism Office of Daet to seamlessly manage, organize, and coordinate local tourism activities.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 sm:gap-4 pt-4">
              <Link
                href="/programs"
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 shadow-lg transition-all"
              >
                Browse Public Events
              </Link>
              <Link
                href="/register"
                onClick={handleCreateAccountClick}
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-white/30 text-white font-bold text-sm hover:bg-white/10 transition-all"
              >
                Create an Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
        <div className="max-w-3xl text-center md:text-left mx-auto md:mx-0">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0a1733]">
            One platform for the people behind every event
          </h2>
          <p className="mt-4 text-base text-gray-600 leading-relaxed font-medium">
            A centralized dashboard environment where each user group accesses exactly the tools they need.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-8 md:gap-0 md:border-t border-gray-200">
          {audiences.map((a, i) => (
            <div
              key={a.title}
              className={`pt-6 md:pt-10 md:px-8 flex flex-col gap-4 border-t md:border-t-0 border-gray-200 ${
                i > 0 ? "md:border-l" : "md:pl-0"
              }`}
            >
              <h3 className="text-xl font-black text-[#0a1733]">{a.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed flex-1 font-medium">{a.text}</p>
              {a.smartLink ? (
                <SubmitProposalLink />
              ) : (
                <Link href={a.href} className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors inline-flex items-center gap-1 w-fit">
                  {a.cta} <span>→</span>
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 lg:py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0a1733] max-w-2xl mx-auto">
            From proposal to published event
          </h2>
          <p className="mt-4 text-sm text-gray-500 font-medium">The standard workflow for Daet Tourism activities.</p>
          
          <ol className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 text-left">
            {steps.map((s, i) => (
              <li key={s.title} className="relative space-y-4">
                <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 font-black text-lg shadow-sm">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-base font-bold text-[#0a1733] leading-snug mb-2">{s.title}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed font-medium">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 lg:py-20 flex flex-col md:flex-row md:items-center justify-between gap-8 text-center md:text-left">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-[#0a1733]">Ready to explore Daet?</h2>
          <p className="mt-2 text-sm text-gray-600 font-medium">Discover verified festivals, fiestas, and municipal activities.</p>
        </div>
        <Link
          href="/programs"
          className="w-full md:w-auto px-8 py-4 rounded-xl bg-[#0a1733] hover:bg-blue-900 text-white font-bold text-sm transition-all shadow-lg"
        >
          View the Event Schedule
        </Link>
      </section>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-gray-500 font-semibold tracking-wide uppercase">
            Municipal Tourism Office of Daet, Camarines Norte
          </p>
          <p className="text-[10px] text-gray-400 font-bold">
            Connect-Daet System v1.0
          </p>
        </div>
      </footer>
      {feedbackUI}
    </main>
  );
}