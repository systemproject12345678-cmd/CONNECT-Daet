"use client";

import { teamMembersOf } from "@/lib/eventSchedule";

// Shows one team registration: team name, who registered it, and every member with the
// details and photo they submitted. Used by the admin and organizer dashboards.
export default function TeamDetails({ registration, onPreview, defaultOpen = false }) {
  const members = teamMembersOf(registration);
  const leader = `${registration.first_name || ""} ${registration.last_name || ""}`.trim();

  return (
    <details open={defaultOpen} className="group rounded-xl border border-gray-200 bg-white">
      <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer list-none p-4">
        <div className="min-w-0">
          <p className="font-black text-slate-900 text-sm truncate">{registration.team_name || "Unnamed team"}</p>
          <p className="text-[11px] text-gray-500 font-medium">
            Registered by {leader || "N/A"} &middot; {members.length} {members.length === 1 ? "member" : "members"}
            {registration.created_at ? ` · ${new Date(registration.created_at).toLocaleDateString()}` : ""}
          </p>
        </div>
        <span className="text-[10px] font-bold text-blue-600 uppercase group-open:hidden">Show members</span>
        <span className="text-[10px] font-bold text-blue-600 uppercase hidden group-open:inline">Hide members</span>
      </summary>

      <div className="border-t border-gray-100 p-4 space-y-3">
        <div className="text-[11px] text-gray-600 font-medium grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <p><strong>Team leader contact:</strong> {registration.email || "N/A"} {registration.phone_number ? `· ${registration.phone_number}` : ""}</p>
          <p><strong>Leader address:</strong> {registration.home_address || "N/A"}</p>
        </div>

        {members.length === 0 ? (
          <p className="text-[11px] text-gray-400 font-bold uppercase">No member details were submitted for this team.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {members.map((m, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50/60">
                {m.photo_url ? (
                  <button
                    type="button"
                    onClick={() => onPreview?.(m.photo_url)}
                    className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100"
                    aria-label={`View photo of ${m.first_name || "member"}`}
                  >
                    <img src={m.photo_url} alt={`${m.first_name || ""} ${m.last_name || ""}`} className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <div className="w-16 h-16 flex-shrink-0 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] text-gray-400 font-bold uppercase text-center">
                    No photo
                  </div>
                )}
                <div className="min-w-0 text-[11px] text-gray-600 font-medium space-y-0.5">
                  <p className="font-black text-slate-900 text-xs">
                    {m.first_name} {m.last_name}
                    {i === 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[9px] font-black uppercase">Leader</span>}
                  </p>
                  <p>{[m.gender, m.age ? `${m.age} yrs` : null, m.civil_status].filter(Boolean).join(" · ") || "N/A"}</p>
                  <p className="break-words">{m.home_address || "No address"}</p>
                  {(m.phone_number || m.email) && <p className="break-words">{[m.phone_number, m.email].filter(Boolean).join(" · ")}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}