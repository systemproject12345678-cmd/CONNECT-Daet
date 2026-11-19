"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useFeedback } from "@/components/ui/Feedback";
import { FilePicker } from "@/components/ui/Attachments";
import { uploadAttachments, validateFiles } from "@/lib/eventHelpers";
import TimePicker from "@/components/ui/TimePicker";

export default function SubmitProposalPage() {
  const router = useRouter();
  const { notify, feedbackUI } = useFeedback();
  const [submitted, setSubmitted] = useState(false);
  const [eventName, setEventName] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [venue, setVenue] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventEndTime, setEventEndTime] = useState("");
  const [description, setDescription] = useState("");
  
  const [imageFiles, setImageFiles] = useState([]);
  const [proposalFiles, setProposalFiles] = useState([]);
  const [maxSlots, setMaxSlots] = useState("");
  // "single" = individual registration, "group" = teams register together, "interested" = publication only
  const [registrationType, setRegistrationType] = useState("single");
  const [teamSize, setTeamSize] = useState("");

  const [isPaid, setIsPaid] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [cashDetails, setCashDetails] = useState("");
  const [onlineDetails, setOnlineDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        setOrganizerName((prev) => prev || profile.organization || profile.organizer_full_name || profile.full_name || "");
      }
    };
    loadOrganizer();
  }, []);

  const isOrganizer = orgProfile?.role === "organizer";

  // Previews for all selected banner files to render a complete gallery grid.
  const bannerPreviews = useMemo(() => {
    return imageFiles.map((item) => {
      const file = item instanceof File ? item : item?.file instanceof File ? item.file : null;
      return file ? URL.createObjectURL(file) : null;
    }).filter(Boolean);
  }, [imageFiles]);

  useEffect(() => {
    return () => {
      bannerPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bannerPreviews]);

  const paidEvent = registrationType !== "interested" && isPaid;

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!eventName.trim()) return notify("Please enter a valid event name.");
    if (!organizerName.trim()) return notify("Please enter the organizer name/organization.");

    if (!eventDate) return notify("Please choose the proposed start date of the event.");
    if (eventEndDate && eventEndDate < eventDate) return notify("The end date cannot be earlier than the proposed start date.");
    if (!eventTime) return notify("Please set the start time of the event. The event status follows this date and time automatically.");
    if (eventEndTime && eventEndTime <= eventTime) return notify("The end time must be later than the start time.");

    const bannerErr = validateFiles(imageFiles);
    if (bannerErr) return notify(bannerErr);

    const propErr = validateFiles(proposalFiles);
    if (propErr) return notify(propErr);

    if (registrationType === "group") {
      const size = parseInt(teamSize, 10);
      if (!(size >= 2 && size <= 50)) return notify("Please set how many members each group has (between 2 and 50).");
      if (!(parseInt(maxSlots, 10) >= 1)) return notify("Please set the total number of team spots available for registration.");
    }

    if (paidEvent) {
      if (!(parseFloat(feeAmount) > 0)) return notify("Please enter the registration fee for this paid event.");
      if (!cashDetails.trim()) return notify("Please state where tourists should hand over their cash payment.");
      if (!onlineDetails.trim()) return notify("Please add the online payment details (for example your GCash number or bank account).");
    }

    setSubmitting(true);

    try {
      let uploadedImageUrls = [];
      if (imageFiles.length > 0) {
        const uploaded = await uploadAttachments(imageFiles, `event-banners/${Date.now()}`);
        uploadedImageUrls = uploaded.map((u) => u.url);
      }

      let uploadedProposalUrls = [];
      if (proposalFiles.length > 0) {
        uploadedProposalUrls = await uploadAttachments(proposalFiles, `organizer-proposals/${Date.now()}`);
      }

      const basePayload = {
        event_name: eventName.trim(),
        organizer_name: organizerName.trim(),
        venue: venue.trim() || "To be announced",
        event_date: eventDate || null,
        end_date: eventEndDate || eventDate || null,
        date: eventDate || null,
        description: description.trim() || "Entry submitted via CONNECT-Daet Proposal Portal",
        event_time: eventTime,
        event_end_time: eventEndTime || null,
        image_url: uploadedImageUrls, // Storing full array of uploaded image links
        organizer_proposal_files: uploadedProposalUrls,
        registration_type: registrationType,
        team_size: registrationType === "group" ? parseInt(teamSize, 10) : null,
        max_slots: registrationType !== "interested" && maxSlots ? parseInt(maxSlots, 10) : null,
        status: "Pending",
        is_paid: paidEvent,
        fee_amount: paidEvent ? parseFloat(feeAmount) : null,
        cash_payment_details: paidEvent ? cashDetails.trim() : null,
        online_payment_details: paidEvent ? onlineDetails.trim() : null,
      };

      let { error: insertError } = await supabase
        .from("tourism_programs")
        .insert([isOrganizer && sessionUser ? { ...basePayload, organizer_id: sessionUser.id } : basePayload]);

      if (insertError && isOrganizer && /organizer_id/i.test(insertError.message || "")) {
        ({ error: insertError } = await supabase.from("tourism_programs").insert([basePayload]));
      }

      if (insertError) throw insertError;

      if (isOrganizer) {
        router.push("/organizer/dashboard");
        return;
      }
      setSubmitted(true);

      setEventName("");
      setOrganizerName(isOrganizer ? orgProfile.organization || orgProfile.organizer_full_name || orgProfile.full_name || "" : "");
      setVenue("");
      setEventDate("");
      setEventEndDate("");
      setEventTime("");
      setEventEndTime("");
      setDescription("");
      setImageFiles([]);
      setProposalFiles([]);
      setMaxSlots("");
      setRegistrationType("single");
      setTeamSize("");
      setIsPaid(false);
      setFeeAmount("");
      setCashDetails("");
      setOnlineDetails("");
    } catch (err) {
      console.error("Proposal submission error:", err);
      notify("Error submitting proposal: " + (err.message || "Unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="daet-ui max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div className="flex flex-wrap gap-3">
        {isOrganizer && (
          <Link
            href="/organizer/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all uppercase tracking-wider shadow-sm"
          >
            ← Back to Organizer Dashboard
          </Link>
        )}
        <Link
          href="/programs"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-xl text-xs font-bold transition-all uppercase tracking-wider"
        >
          ← Back to Public Schedule
        </Link>
      </div>

      {submitted && (
        <div className="bg-white rounded-2xl p-10 border border-gray-200 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-100 text-blue-900 flex items-center justify-center text-2xl font-black">✓</div>
          <h2 className="text-xl font-black text-blue-900">Proposal received</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            It will appear on the public schedule with its photo once the Municipal Tourism Office verifies it.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              onClick={() => setSubmitted(false)}
              className="px-5 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              Submit another proposal
            </button>
            <Link
              href="/programs"
              className="px-5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-xl text-xs font-bold transition-all"
            >
              ← Back to Public Schedule
            </Link>
          </div>
        </div>
      )}

      <div className={submitted ? "hidden" : ""}>
        <div className="bg-white rounded-2xl p-8 md:p-10 border border-gray-200 shadow-sm space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-6">
            <div>
              <h1 className="text-xl font-black uppercase text-slate-900 tracking-tight">
                Submit Event Proposal
              </h1>
              <p className="text-xs text-gray-500 mt-0.5 font-semibold">
                Submit details, downloadable banner attachments, and official proposal requirements for verification by the Tourism Office.
              </p>
            </div>
            <span className="self-start md:self-auto px-3.5 py-1.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-full uppercase tracking-wider">
              Requires Admin Review
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                Event Banner Photos (Multiple allowed, fully downloadable)
              </label>
              <FilePicker
                files={imageFiles}
                onChange={setImageFiles}
                label="Choose event banner images"
                hint="PNG, JPG, or WEBP - multiple files allowed"
                multiple={true}
              />
              
              {/* Multi-Image Preview Grid */}
              {bannerPreviews.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {bannerPreviews.map((previewUrl, idx) => (
                      <div key={idx} className="relative group aspect-video rounded-xl overflow-hidden bg-slate-100 border border-gray-200">
                        <img src={previewUrl} alt={`Banner preview ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = imageFiles.filter((_, i) => i !== idx);
                            setImageFiles(updated);
                          }}
                          className="absolute top-2 right-2 px-2 py-1 bg-red-600/90 hover:bg-red-600 text-white rounded-lg text-[10px] font-bold uppercase transition-all shadow-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 font-medium">
                    Previews of attached banner photos. Event images are shown in a 16:9 frame and cropped to fit.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                True Proposal Documents & Requirements * (Multiple allowed, fully downloadable)
              </label>
              <FilePicker
                files={proposalFiles}
                onChange={setProposalFiles}
                label="Attach official proposal files / PDFs"
                hint="Upload all required documentation files for admin review"
                multiple={true}
              />
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

              {registrationType === "single" && (
                <Input
                  label="Attendee Slot Limit (Quota)"
                  type="number"
                  min="1"
                  placeholder="e.g. 150 (Leave blank for unlimited)"
                  value={maxSlots}
                  onChange={(e) => setMaxSlots(e.target.value)}
                />
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Proposed Date *
                </label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  End Date (Optional)
                </label>
                <input
                  type="date"
                  value={eventEndDate}
                  onChange={(e) => setEventEndDate(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 font-medium -mt-3">
              The day the event concludes. If left blank, it defaults to a single-day event ending on the Proposed Date.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <TimePicker label="Start Time" required value={eventTime} onChange={setEventTime} />

              <TimePicker label="End Time" optional value={eventEndTime} onChange={setEventEndTime} />
            </div>
            <p className="text-[11px] text-gray-400 font-medium -mt-3">
              Once approved, the event shows as Upcoming, Ongoing and Completed automatically based on this date and time.
              Without an end time, the event stays Ongoing until the end of its date.
            </p>

            <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/50 p-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  How do tourists take part? *
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { value: "single", title: "Single registration", text: "Each tourist registers as an individual and joins this event." },
                    { value: "group", title: "Group registration", text: "Teams register together: a team name, its members and member photos." },
                    { value: "interested", title: "Interested only", text: "No official registration. The event is posted for publication and tourists tap Interested." },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRegistrationType(opt.value)}
                      aria-pressed={registrationType === opt.value}
                      className={`text-left p-4 rounded-2xl border-2 transition-all ${
                        registrationType === opt.value ? "border-blue-900 bg-white shadow-sm" : "border-gray-200 bg-white hover:border-blue-300"
                      }`}
                    >
                      <p className={`text-xs font-black uppercase ${registrationType === opt.value ? "text-blue-900" : "text-slate-900"}`}>{opt.title}</p>
                      <p className="text-[11px] text-gray-500 font-medium mt-1 leading-relaxed">{opt.text}</p>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 font-medium mt-2">You cannot change this after you submit.</p>
              </div>

              {registrationType === "interested" && (
                <p className="text-[11px] text-blue-900 bg-blue-50 border border-blue-100 rounded-xl p-3 font-medium">
                  Once the Tourism Office approves this event, tourists will only see an <strong>Interested</strong> button on it
                  (no "Join this event"). You will be able to see how many tourists are interested from your Organizer Dashboard, so you know how many people to expect.
                </p>
              )}

              {registrationType === "group" && (
                <div className="space-y-4">
                  <p className="text-[11px] text-blue-900 bg-blue-50 border border-blue-100 rounded-xl p-3 font-medium">
                    Each team registers once: the team leader enters the <strong>team name</strong>, adds every <strong>team member</strong> with their details and a <strong>photo</strong>.
                    One team takes one spot.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input
                      label="Members per Group *"
                      type="number"
                      min="2"
                      max="50"
                      placeholder="e.g. 5 (includes the team leader)"
                      value={teamSize}
                      onChange={(e) => setTeamSize(e.target.value)}
                    />
                    <Input
                      label="Total Team Spots Available *"
                      type="number"
                      min="1"
                      placeholder="e.g. 20 teams"
                      value={maxSlots}
                      onChange={(e) => setMaxSlots(e.target.value)}
                    />
                  </div>
                </div>
              )}
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

            {registrationType !== "interested" && (
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/50 p-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  {registrationType === "group" ? "Payment Option (per team)" : "Participation Fee"}
                </label>
                <div className="inline-flex gap-1 bg-gray-100 p-1 rounded-xl">
                  {[
                    { value: false, label: "Free event" },
                    { value: true, label: "Paid event" },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setIsPaid(opt.value)}
                      aria-pressed={isPaid === opt.value}
                      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${
                        isPaid === opt.value ? "bg-blue-900 text-white shadow-sm" : "text-gray-600 hover:bg-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!isPaid && (
                  <p className="text-[11px] text-gray-400 font-medium mt-2">
                    {registrationType === "group" ? "Teams are registered immediately and added to your team list." : "Tourists are registered immediately and added to your attendee list."} You cannot change this after you submit.
                  </p>
                )}
              </div>

              {isPaid && (
                <div className="space-y-4">
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3 font-medium">
                    Tourists will stay on your pending list until you confirm their payment. Only then are they added to the official attendee list. Payment settings cannot be changed after you submit the proposal.
                  </p>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {registrationType === "group" ? "Registration Fee per Team (PHP) *" : "Registration Fee per Participant (PHP) *"}
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="e.g. 250"
                      value={feeAmount}
                      onChange={(e) => setFeeAmount(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Cash Payment: where should tourists pay? *
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Daet Cultural Committee office, 2nd floor Municipal Hall, Mon-Fri 8AM-5PM. Ask for Ms. Reyes."
                      value={cashDetails}
                      onChange={(e) => setCashDetails(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Online Payment: how should tourists pay? *
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. GCash 0917 123 4567 (Juan Dela Cruz). Send the exact amount and enter the reference number in the form."
                      value={onlineDetails}
                      onChange={(e) => setOnlineDetails(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                    />
                  </div>
                </div>
              )}
            </div>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full h-12 uppercase text-xs font-bold tracking-wider bg-blue-900 hover:bg-blue-800 text-white"
                disabled={submitting}
              >
                {submitting ? "Uploading Files & Submitting Proposal..." : "Submit Event Proposal"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <p className="text-center text-gray-400 text-[10px] uppercase font-bold tracking-widest pt-4">
        CONNECT-DAET MUNICIPAL TOURISM MANAGEMENT SYSTEM
      </p>
      {feedbackUI}
    </div>
  );
}