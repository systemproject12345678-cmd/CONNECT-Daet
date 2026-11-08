"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useFeedback } from "@/components/ui/Feedback";

export default function SubmitProposalPage() {
  const router = useRouter();
  const { notify, feedbackUI } = useFeedback();
  const [submitted, setSubmitted] = useState(false);
  const [eventName, setEventName] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [venue, setVenue] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Signed-in organizer details (used to link the proposal to the organizer dashboard)
  const [sessionUser, setSessionUser] = useState(null);
  const [orgProfile, setOrgProfile] = useState(null);

  useEffect(() => {
    const loadOrganizer = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setSessionUser(session.user);

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      setOrgProfile(profile);
      if (profile?.role === "organizer") {
        // Pre-fill the host name so it always matches the organizer account
        setOrganizerName((prev) => prev || profile.organization || profile.organizer_full_name || profile.full_name || "");
      }
    };
    loadOrganizer();
  }, []);

  const isOrganizer = orgProfile?.role === "organizer";

  // Handle Photo Selection
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!eventName.trim()) return notify("Please enter a valid event name.");
    if (!organizerName.trim()) return notify("Please enter the organizer name/organization.");

    setSubmitting(true);

    try {
      let uploadedImageUrl = null;

      // 1. Upload photo to Supabase Storage bucket if attached
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
        const filePath = `events/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("event-banners")
          .upload(filePath, imageFile);

        if (uploadError) throw uploadError;

        // Retrieve public URL for the uploaded photo
        const { data: urlData } = supabase.storage
          .from("event-banners")
          .getPublicUrl(filePath);

        uploadedImageUrl = urlData.publicUrl;
      }

      // 2. Insert event record into database table
      const basePayload = {
        event_name: eventName.trim(),
        organizer_name: organizerName.trim(),
        venue: venue.trim() || "To be announced",
        event_date: eventDate || null,
        date: eventDate || null,
        description: description.trim() || "Entry submitted via CONNECT-Daet Proposal Portal",
        image_url: uploadedImageUrl, // Save photo public URL
        status: "Pending", // Default review status
      };

      // Link the event to the signed-in organizer so the organizer & admin dashboards stay in sync.
      // If the table has no organizer_id column, fall back to the original payload.
      let { error: insertError } = await supabase
        .from("tourism_programs")
        .insert([isOrganizer && sessionUser ? { ...basePayload, organizer_id: sessionUser.id } : basePayload]);

      if (insertError && isOrganizer && /organizer_id/i.test(insertError.message || "")) {
        ({ error: insertError } = await supabase.from("tourism_programs").insert([basePayload]));
      }

      if (insertError) throw insertError;

      // No popup: organizers go straight back to their dashboard, others see an inline confirmation
      if (isOrganizer) {
        router.push("/organizer/dashboard");
        return;
      }
      setSubmitted(true);

      // Reset form
      setEventName("");
      setOrganizerName(isOrganizer ? orgProfile.organization || orgProfile.organizer_full_name || orgProfile.full_name || "" : "");
      setVenue("");
      setEventDate("");
      setDescription("");
      setImageFile(null);
      setImagePreview(null);
    } catch (err) {
      console.error("Proposal submission error:", err);
      notify("Error submitting proposal: " + (err.message || "Unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-6">
      {/* Back Link */}
      <div className="flex flex-wrap gap-3">
        {isOrganizer && (
          <Link
            href="/organizer/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all uppercase tracking-wider"
          >
            &larr; Back to Organizer Dashboard
          </Link>
        )}
        <Link
          href="/programs"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-all uppercase tracking-wider"
        >
          &larr; Back to Public Schedule
        </Link>
      </div>

      {submitted && (
        <div className="bg-white rounded-[35px] p-10 border border-blue-50 shadow-2xl shadow-blue-100/50 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-black">&#10003;</div>
          <h2 className="text-xl font-black text-blue-900">Proposal received</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            It will appear on the public schedule with its photo once the Municipal Tourism Office verifies it.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              onClick={() => setSubmitted(false)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all"
            >
              Submit another proposal
            </button>
            <Link
              href="/programs"
              className="px-5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-all"
            >
              &larr; Back to Public Schedule
            </Link>
          </div>
        </div>
      )}

      {/* Main Form Container */}
      <div className={submitted ? "hidden" : ""}>
        <div className="bg-white rounded-[35px] p-8 md:p-10 border border-blue-50 shadow-2xl shadow-blue-100/50 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-6">
          <div>
            <h1 className="text-2xl font-black italic uppercase text-blue-900 tracking-tight">
              Submit Event Proposal
            </h1>
            <p className="text-xs text-gray-500 mt-1 font-medium">
              Submit details and an event banner photo for verification by the Tourism Office.
            </p>
          </div>
          <span className="self-start md:self-auto px-3.5 py-1.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-full uppercase tracking-wider">
            Requires Admin Review
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Photo Upload Input Field */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
              Event Banner / Photo Attachment
            </label>
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-3xl p-6 hover:border-blue-400 transition-all bg-gray-50/50">
              {imagePreview ? (
                <div className="space-y-4 w-full text-center">
                  <img
                    src={imagePreview}
                    alt="Event Preview"
                    className="w-full h-48 object-cover rounded-2xl shadow-md"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImageFile(null);
                      setImagePreview(null);
                    }}
                    className="text-xs font-bold text-red-600 hover:underline"
                  >
                    Remove Selected Photo
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer text-center space-y-2">
                  <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto text-xl font-bold">
                    📷
                  </div>
                  <p className="text-xs font-bold text-gray-700">Click to upload event picture</p>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">PNG, JPG, or WEBP up to 5MB</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Event Name *"
              placeholder="e.g. Pinyasan Festival 2026"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              required
            />

            <Input
              label="Organizer / Host Name *"
              placeholder="e.g. Daet Cultural Committee"
              value={organizerName}
              onChange={(e) => setOrganizerName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Proposed Venue / Location"
              placeholder="e.g. Daet Express Town Plaza"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
            />

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Proposed Date
              </label>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              Event Description & Details
            </label>
            <textarea
              rows={4}
              placeholder="Provide event summary, target audience, and proposed schedule..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
            />
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              className="w-full h-12 uppercase text-xs font-bold tracking-wider"
              disabled={submitting}
            >
              {submitting ? "Uploading Photo & Submitting..." : "Submit Event Proposal"}
            </Button>
          </div>
        </form>
      </div>
      </div>

      {/* Footer */}
      <p className="text-center text-gray-400 text-[10px] uppercase font-bold tracking-widest pt-4">
        CONNECT-DAET MUNICIPAL TOURISM MANAGEMENT SYSTEM
      </p>
      {feedbackUI}
    </div>
  );
}