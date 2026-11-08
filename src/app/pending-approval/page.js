"use client";

import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function PendingApprovalPage() {
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="max-w-lg mx-auto py-16 px-4 text-center">
      <div className="bg-white p-10 rounded-[40px] shadow-2xl border border-amber-100 space-y-6">
        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto text-2xl font-black">
          ⏳
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
            Account Pending Approval
          </h1>
          <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto">
            Your organizer account registration has been received and is currently under verification by the **Municipal Tourism Office**.
          </p>
        </div>

        <div className="bg-amber-50 p-4 rounded-2xl text-left border border-amber-100 text-xs text-amber-900 space-y-1">
          <p className="font-bold uppercase text-[10px] text-amber-700 tracking-wider">What happens next?</p>
          <p>• Tourism personnel will review your organization details.</p>
          <p>• Once approved, logging in will grant access to submit event proposals.</p>
        </div>

        <div className="pt-4 space-y-3">
          <a href="/programs">
            <Button variant="secondary" className="w-full h-11">
              Browse Public Schedule
            </Button>
          </a>
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-400 font-bold uppercase tracking-wider hover:text-gray-600 pt-2 block mx-auto"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}