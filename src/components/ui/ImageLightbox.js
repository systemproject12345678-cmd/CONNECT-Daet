"use client";

import { useEffect } from "react";

/**
 * Full-view image viewer shared by the guest, tourist, organizer and admin pages.
 * Usage: {viewerSrc && <ImageLightbox src={viewerSrc} alt="..." onClose={() => setViewerSrc(null)} />}
 */
export default function ImageLightbox({ src, alt = "Event photo", onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl uppercase tracking-wider transition-all"
      >
        &larr; Close
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-[88vh] object-contain rounded-2xl shadow-2xl"
      />
    </div>
  );
}