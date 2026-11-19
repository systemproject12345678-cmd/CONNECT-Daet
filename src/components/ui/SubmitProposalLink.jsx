"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useFeedback } from "@/components/ui/Feedback";

export default function SubmitProposalLink() {
  const router = useRouter();
  const { notify, feedbackUI } = useFeedback();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const OFFICIAL_ADMIN_EMAIL = "admin.daet@gmail.com";

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        const { data: userProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();
        setProfile(userProfile);
      }
    });
  }, []);

  const handleClick = (e) => {
    e.preventDefault();

    if (!user) {
      router.push("/register?role=organizer");
      return;
    }

    const isAdmin =
      user.email?.toLowerCase() === OFFICIAL_ADMIN_EMAIL.toLowerCase() ||
      profile?.role === "admin";

    if (isAdmin) {
      router.push("/admin");
      return;
    }

    if (profile?.role === "organizer") {
      router.push("/programs/submit");
      return;
    }

    notify("Only event organizers can submit event proposals.", "info");
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors inline-flex items-center gap-1 w-fit text-left"
      >
        Submit an event proposal <span>&rarr;</span>
      </button>
      {feedbackUI}
    </>
  );
}