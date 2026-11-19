import { supabase } from "@/lib/supabase";

// Reuses the bucket you already have for event banners (public bucket).
export const ATTACHMENT_BUCKET = "event-banners";
export const ACCEPTED_FILE_TYPES = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";
export const MAX_FILE_MB = 10;

export const normStatus = (s) => (s || "").toString().trim().toLowerCase();

export const isImageFile = (f) =>
  (f?.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/i.test(f?.name || "");

export const formatBytes = (n) => {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export const peso = (n) => {
  const num = Number(n);
  if (!isFinite(num)) return "";
  return `\u20B1${num.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

// Registration state helper. Rows created before payments existed have no
// registration_status, so they count as confirmed.
export const regState = (reg) => normStatus(reg?.registration_status) || "confirmed";

// Returns an error message, or null when every file is fine.
export const validateFiles = (files) => {
  for (const f of files) {
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      return `"${f.name}" is larger than ${MAX_FILE_MB}MB.`;
    }
  }
  return null;
};

// Uploads File objects and returns [{ name, url, download_url, type, size, uploaded_at }]
export async function uploadAttachments(files, folder) {
  const results = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${safeName}`;

    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file);
    if (error) throw new Error(`Could not upload "${file.name}": ${error.message}`);

    const { data: viewData } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(path);
    // The `download` option makes the browser save the file instead of opening it
    const { data: dlData } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(path, { download: file.name });

    results.push({
      name: file.name,
      url: viewData.publicUrl,
      download_url: dlData.publicUrl,
      type: file.type || "",
      size: file.size,
      uploaded_at: new Date().toISOString(),
    });
  }
  return results;
}

// Safely extracts a list of image URLs whether stored as a plain string, JSON string, or array.
export const getImageList = (urlField) => {
  if (!urlField) return [];
  if (typeof urlField === "string") {
    if (urlField.startsWith("[")) {
      try {
        const parsed = JSON.parse(urlField);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch (e) {
        console.warn("Failed to parse image URL JSON string", e);
      }
    }
    return [urlField].filter(Boolean);
  }
  if (Array.isArray(urlField)) {
    return urlField.filter(Boolean);
  }
  return [];
};