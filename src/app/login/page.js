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

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return alert("Please fill in email and password.");

    setLoading(true);

    try {
      // 1. Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) throw authError;

      const userId = authData.user?.id;

      // 2. Fetch user profile status & role
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError && profileError.code !== "PGRST116") {
        console.warn("Profile fetch warning:", profileError.message);
      }

      // 3. Redirection Logic
      if (profile?.role === "admin") {
        alert("Welcome, Tourism Administrator!");
        router.push("/admin");
      } else if (profile?.status === "Approved") {
        alert("Welcome back! You can now submit and manage event proposals.");
        router.push("/programs");
      } else if (profile?.status === "Rejected") {
        alert("Your account registration was declined. Please contact the Municipal Tourism Office.");
        await supabase.auth.signOut();
      } else {
        // Pending or missing status default
        router.push("/pending-approval");
      }
    } catch (error) {
      console.error("Login error:", error);
      alert(error.message || "Invalid login credentials.");
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

        <form onSubmit={handleLogin} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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