"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Button from "@/components/ui/Button";

export default function RegisterPage() {
  const router = useRouter();

  // Selected Role Tab ('tourist' | 'organizer')
  const [roleTab, setRoleTab] = useState("tourist");
  const [loading, setLoading] = useState(false);

  // Common Fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress] = useState("");

  // Tourist Specific Fields
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("Male");

  // Organizer Specific Credibility Fields
  const [organization, setOrganization] = useState("");
  const [organizerFullName, setOrganizerFullName] = useState("");
  const [orgType, setOrgType] = useState("Company");
  const [websiteLink, setWebsiteLink] = useState("");

  // Organizer Attachments State (BIR, DTI/SEC, Business Permit, Valid ID, Logo)
  const [birTinUrl, setBirTinUrl] = useState("");
  const [dtiSecUrl, setDtiSecUrl] = useState("");
  const [businessPermitUrl, setBusinessPermitUrl] = useState("");
  const [validIdUrl, setValidIdUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  // Helper to convert uploaded image to Base64 string for storage
  const handleFileUpload = (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (field === "birTin") setBirTinUrl(reader.result);
      if (field === "dtiSec") setDtiSecUrl(reader.result);
      if (field === "businessPermit") setBusinessPermitUrl(reader.result);
      if (field === "validId") setValidIdUrl(reader.result);
      if (field === "logo") setLogoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleRegister = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      return alert("Please enter a valid email and password.");
    }

    if (roleTab === "tourist") {
      if (!fullName.trim()) {
        return alert("Please enter your full name.");
      }
      if (!age || isNaN(age) || parseInt(age, 10) <= 0) {
        return alert("Please enter a valid age.");
      }
      if (!sex) {
        return alert("Please select your sex.");
      }
    }

    if (roleTab === "organizer") {
      if (!organization.trim() || !organizerFullName.trim() || !contactNumber.trim()) {
        return alert("Organizers must fill in all required organization name, representative full name, and contact number.");
      }
      if (!birTinUrl || !dtiSecUrl || !businessPermitUrl || !validIdUrl || !logoUrl) {
        return alert("Organizers must attach all required verification photos: BIR TIN, DTI/SEC Registration, Business Permit, Representative Valid ID, and Organization Logo.");
      }
    }

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    const activeFullName = roleTab === "organizer" ? organizerFullName.trim() : fullName.trim();

    try {
      // 1. Sign up user in Supabase Auth & pass metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: activeFullName,
            role: roleTab,
          },
        },
      });

      if (authError) {
        if (authError.message.toLowerCase().includes("already registered")) {
          throw new Error("This email address is already registered. Please sign in instead.");
        }
        throw authError;
      }

      const userId = authData.user?.id;

      if (userId) {
        // 2. Prepare Profile Payload based on account type
        const profilePayload = {
          id: userId,
          full_name: activeFullName,
          email: cleanEmail,
          role: roleTab,
          contact_number: contactNumber.trim() || null,
          address: address.trim() || null,
          status: roleTab === "organizer" ? "Pending" : "Approved", // Organizers require admin review
        };

        if (roleTab === "tourist") {
          profilePayload.age = parseInt(age, 10);
          profilePayload.sex = sex;
        }

        if (roleTab === "organizer") {
          profilePayload.organization = organization.trim();
          profilePayload.organizer_full_name = organizerFullName.trim();
          profilePayload.org_type = orgType;
          profilePayload.bir_tin = birTinUrl;
          profilePayload.dti_sec_reg = dtiSecUrl;
          profilePayload.business_permit_no = businessPermitUrl;
          profilePayload.website_link = websiteLink.trim() || null;
          profilePayload.bir_status = "Pending Verification";
          profilePayload.valid_id_url = validIdUrl;
          profilePayload.logo_url = logoUrl;
        }

        // 3. Upsert into public.profiles
        const { error: profileError } = await supabase.from("profiles").upsert(
          [profilePayload],
          { onConflict: "id" }
        );

        if (profileError) throw profileError;
      }

      if (roleTab === "organizer") {
        alert("Organizer registration submitted! Your credibility credentials and attachments are pending review by the Municipal Tourism Office.");
        router.push("/pending-approval");
      } else {
        alert("Tourist account created successfully! You can now log in and participate in municipal events.");
        router.push("/login");
      }
    } catch (error) {
      console.error("Registration error:", error);
      alert(error.message || "An error occurred during registration.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="bg-white p-8 md:p-10 rounded-[35px] shadow-2xl border border-blue-50 space-y-8">
        {/* Page Header */}
        <div className="text-center space-y-2">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 text-[10px] font-black rounded-full uppercase tracking-wider">
            CONNECT-Daet System Registration
          </span>
          <h1 className="text-3xl font-black text-blue-900 uppercase tracking-tight">
            Create an Account
          </h1>
          <p className="text-xs text-gray-400">
            Select your registration role to continue
          </p>
        </div>

        {/* Role Selector Tabs */}
        <div className="grid grid-cols-2 p-1.5 bg-gray-100 rounded-2xl gap-1">
          <button
            type="button"
            onClick={() => setRoleTab("tourist")}
            className={`py-3 text-xs font-black rounded-xl uppercase tracking-wider transition-all ${
              roleTab === "tourist"
                ? "bg-white text-blue-900 shadow-md"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            ✈️ Tourist / Visitor
          </button>
          <button
            type="button"
            onClick={() => setRoleTab("organizer")}
            className={`py-3 text-xs font-black rounded-xl uppercase tracking-wider transition-all ${
              roleTab === "organizer"
                ? "bg-white text-blue-900 shadow-md"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            🏛️ Event Organizer
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleRegister} className="space-y-4 text-xs font-semibold">
          <div className="bg-blue-50/60 p-4 rounded-2xl border border-blue-100">
            <p className="text-[11px] text-blue-800 leading-relaxed">
              {roleTab === "tourist"
                ? "Tourist Registration: Allows you to view and register to participate in official municipal events across Daet."
                : "Organizer Credibility Registration: Attach official verification documents (BIR TIN, DTI/SEC, Business Permit, Valid ID, Logo) to create and host official events."}
            </p>
          </div>

          {/* TOURIST FIELDS */}
          {roleTab === "tourist" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-600 mb-1">FULL NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Juan Dela Cruz"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">EMAIL ADDRESS *</label>
                  <input
                    type="email"
                    required
                    placeholder="user@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 mb-1">PASSWORD *</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>
              </div>

              {/* AGE AND SEX FIELDS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">AGE *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="120"
                    placeholder="e.g. 25"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 mb-1">SEX *</label>
                  <select
                    required
                    value={sex}
                    onChange={(e) => setSex(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">PHONE / CONTACT NUMBER</label>
                  <input
                    type="tel"
                    placeholder="09XXXXXXXXX"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 mb-1">HOME ADDRESS</label>
                  <input
                    type="text"
                    placeholder="Daet, Camarines Norte"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* EVENT ORGANIZER FIELDS */
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                Organizer Credibility & Verification Info
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">ORGANIZATION / AGENCY NAME *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Daet Arts & Culture Guild"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">ORGANIZER'S FULL NAME *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Maria Santos"
                    value={organizerFullName}
                    onChange={(e) => setOrganizerFullName(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">EMAIL ADDRESS *</label>
                  <input
                    type="email"
                    required
                    placeholder="organizer@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 mb-1">PASSWORD *</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 mb-1">CONTACT NUMBER *</label>
                  <input
                    type="tel"
                    required
                    placeholder="09XXXXXXXXX"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 mb-1">ORGANIZATION TYPE *</label>
                  <select
                    value={orgType}
                    onChange={(e) => setOrgType(e.target.value)}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                  >
                    <option value="Company">Company / Enterprise</option>
                    <option value="School">School / Educational Institution</option>
                    <option value="Individual">Individual Host</option>
                    <option value="NGO">Non-Profit Organization (NGO)</option>
                    <option value="LGU">Local Government Unit (LGU)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-gray-600 mb-1">
                  ORGANIZATION ADDRESS <span className="text-gray-400 font-normal">(OPTIONAL)</span>
                </label>
                <input
                  type="text"
                  placeholder="Daet, Camarines Norte"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                />
              </div>

              <div>
                <label className="block text-gray-600 mb-1">
                  WEBSITE OR SOCIAL MEDIA PAGE <span className="text-gray-400 font-normal">(OPTIONAL)</span>
                </label>
                <input
                  type="url"
                  placeholder="https://facebook.com/your-org"
                  value={websiteLink}
                  onChange={(e) => setWebsiteLink(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
                />
              </div>

              {/* ATTACHMENTS SECTION */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl space-y-2">
                  <label className="block text-slate-900 font-bold">BIR TIN (TAX ID) PHOTO *</label>
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => handleFileUpload(e, "birTin")}
                    className="text-[11px] text-gray-500"
                  />
                  {birTinUrl && (
                    <img src={birTinUrl} alt="BIR TIN Preview" className="h-20 object-cover rounded-lg border mt-2" />
                  )}
                </div>

                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl space-y-2">
                  <label className="block text-slate-900 font-bold">DTI / SEC REGISTRATION PHOTO *</label>
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => handleFileUpload(e, "dtiSec")}
                    className="text-[11px] text-gray-500"
                  />
                  {dtiSecUrl && (
                    <img src={dtiSecUrl} alt="DTI/SEC Preview" className="h-20 object-cover rounded-lg border mt-2" />
                  )}
                </div>

                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl space-y-2">
                  <label className="block text-slate-900 font-bold">BUSINESS PERMIT PHOTO *</label>
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => handleFileUpload(e, "businessPermit")}
                    className="text-[11px] text-gray-500"
                  />
                  {businessPermitUrl && (
                    <img src={businessPermitUrl} alt="Business Permit Preview" className="h-20 object-cover rounded-lg border mt-2" />
                  )}
                </div>

                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl space-y-2">
                  <label className="block text-slate-900 font-bold">REPRESENTATIVE VALID ID *</label>
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => handleFileUpload(e, "validId")}
                    className="text-[11px] text-gray-500"
                  />
                  {validIdUrl && (
                    <img src={validIdUrl} alt="Valid ID Preview" className="h-20 object-cover rounded-lg border mt-2" />
                  )}
                </div>

                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl space-y-2 md:col-span-2">
                  <label className="block text-slate-900 font-bold">ORGANIZATION LOGO *</label>
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => handleFileUpload(e, "logo")}
                    className="text-[11px] text-gray-500"
                  />
                  {logoUrl && (
                    <img src={logoUrl} alt="Logo Preview" className="h-20 object-cover rounded-lg border mt-2" />
                  )}
                </div>
              </div>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full h-12 mt-4 uppercase text-xs font-bold tracking-wider"
            disabled={loading}
          >
            {loading ? "Submitting Registration..." : `Register as ${roleTab === "organizer" ? "Event Organizer" : "Tourist"}`}
          </Button>
        </form>

        <p className="text-center text-xs text-gray-500 pt-2">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-900 font-bold hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}