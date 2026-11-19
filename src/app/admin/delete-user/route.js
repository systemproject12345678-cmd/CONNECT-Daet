import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Deleting a login account needs the Supabase *service role* key, which must never reach the browser.
// This route runs on the server, checks that the caller is the administrator, then removes the account.
// Required environment variables (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (Supabase > Project Settings > API > service_role). Do NOT prefix with NEXT_PUBLIC_.

const OFFICIAL_ADMIN_EMAIL = "admin.daet@gmail.com";

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local and restart the dev server." },
      { status: 500 }
    );
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 1) Who is calling?
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    const caller = callerData?.user;
    if (callerErr || !caller) return NextResponse.json({ error: "Your session has expired. Please log in again." }, { status: 401 });

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
    const isAdmin = callerProfile?.role === "admin" || caller.email?.toLowerCase() === OFFICIAL_ADMIN_EMAIL.toLowerCase();
    if (!isAdmin) return NextResponse.json({ error: "Only administrators can delete accounts." }, { status: 403 });

    // 2) Who is being deleted?
    const { userId } = await request.json().catch(() => ({}));
    if (!userId || typeof userId !== "string") return NextResponse.json({ error: "No account was specified." }, { status: 400 });
    if (userId === caller.id) return NextResponse.json({ error: "You cannot delete your own administrator account." }, { status: 400 });

    const { data: target } = await admin.from("profiles").select("id, role, email").eq("id", userId).maybeSingle();
    if (target?.role === "admin" || target?.email?.toLowerCase() === OFFICIAL_ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: "Administrator accounts cannot be deleted here." }, { status: 400 });
    }

    // 3) Remove everything that points at this account, then the account itself.
    const step = async (label, promise) => {
      const { error } = await promise;
      if (error) throw new Error(`${label}: ${error.message}`);
    };

    if (target?.role === "organizer") {
      const { data: ownedEvents, error: evErr } = await admin.from("tourism_programs").select("id").eq("organizer_id", userId);
      if (evErr) throw new Error(`Loading the organizer's events: ${evErr.message}`);
      const eventIds = (ownedEvents || []).map((e) => e.id);
      if (eventIds.length > 0) {
        await step("Deleting registrations of the organizer's events", admin.from("event_registrations").delete().in("event_id", eventIds));
        await step("Deleting interest records of the organizer's events", admin.from("interested_events").delete().in("event_id", eventIds));
        await step("Deleting the organizer's events", admin.from("tourism_programs").delete().in("id", eventIds));
      }
    }

    await step("Deleting the account's registrations", admin.from("event_registrations").delete().eq("user_id", userId));
    await step("Deleting the account's interested events", admin.from("interested_events").delete().eq("user_id", userId));
    await step("Deleting the profile", admin.from("profiles").delete().eq("id", userId));

    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    // "User not found" just means the login was already gone; the profile cleanup above is what matters.
    if (authErr && !/not found/i.test(authErr.message || "")) throw new Error(`Deleting the login: ${authErr.message}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete-user error:", err);
    return NextResponse.json({ error: err.message || "Unexpected error while deleting the account." }, { status: 500 });
  }
}