"use client";

import { useState } from "react";

export function ImageCarousel({ images = [], onPreview, className = "" }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className={`flex items-center justify-center text-gray-400 text-[10px] font-bold uppercase bg-slate-100 ${className}`}>
        No Photo
      </div>
    );
  }

  const currentImg = images[currentIndex];

  const handlePrev = (e) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = (e) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className={`relative overflow-hidden group bg-slate-100 ${className}`}>
      <img
        src={currentImg}
        alt="Event banner"
        className="w-full h-full object-cover cursor-pointer transition-transform duration-300 hover:scale-105"
        onClick={() => onPreview && onPreview(currentImg)}
        onError={(e) => {
          e.target.src = "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=600&q=80";
        }}
      />

      <span className="absolute bottom-2 right-2 px-2.5 py-1 bg-black/60 text-white text-[10px] font-bold rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        Click to enlarge
      </span>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={handlePrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-black/50 hover:bg-black/75 text-white rounded-full flex items-center justify-center text-sm font-bold opacity-80 group-hover:opacity-100 transition-opacity shadow-md z-10"
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-black/50 hover:bg-black/75 text-white rounded-full flex items-center justify-center text-sm font-bold opacity-80 group-hover:opacity-100 transition-opacity shadow-md z-10"
            aria-label="Next photo"
          >
            ›
          </button>

          <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 text-white text-[9px] font-bold rounded-full backdrop-blur-sm z-10">
            {currentIndex + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  );
}