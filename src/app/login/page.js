"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!email || !password) {
      setErrorMsg("Please fill in email and password.");
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) throw authError;

      const userId = authData.user?.id;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError && profileError.code !== "PGRST116") {
        console.warn("Profile fetch warning:", profileError.message);
      }

      if (profile?.role === "admin") {
        router.push("/admin");
      } else if (profile?.status === "Approved") {
        router.push("/programs");
      } else if (profile?.status === "Rejected") {
        setErrorMsg("Your account registration was declined. Please contact the Municipal Tourism Office.");
        await supabase.auth.signOut();
      } else {
        router.push("/pending-approval");
      }
    } catch (error) {
      setErrorMsg(error?.message || "Invalid login credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="bg-white p-8 md:p-10 rounded-[35px] shadow-2xl border border-blue-50 space-y-6">
        <div className="text-center space-y-2">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-full uppercase tracking-wider">
            CONNECT-Daet Portal
          </span>
          <h1 className="text-2xl font-black text-blue-900 uppercase tracking-tight">
            Account Sign In
          </h1>
          <p className="text-xs text-gray-400">
            Log in to manage your events or access administrative controls
          </p>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2.5 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0 mt-0.5 text-rose-600"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="leading-relaxed">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errorMsg) setErrorMsg("");
            }}
          />

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMsg) setErrorMsg("");
              }}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <Button variant="primary" className="w-full h-12 mt-4" disabled={loading}>
            {loading ? "Authenticating..." : "Sign In"}
          </Button>
        </form>

        <p className="text-center text-xs text-gray-500 pt-2">
          Need an organizer account?{" "}
          <a href="/register" className="text-blue-900 font-bold hover:underline">
            Register Here
          </a>
        </p>
      </div>
    </div>
  );
}