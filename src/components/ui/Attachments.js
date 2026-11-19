"use client";

import { useRef } from "react";
import { ACCEPTED_FILE_TYPES, formatBytes, isImageFile } from "@/lib/eventHelpers";

// Read-only list of uploaded files with View + Download buttons.
export function AttachmentList({ files, onPreview, emptyText = "No files attached." }) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return <p className="text-[11px] text-gray-400 font-semibold">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {list.map((f, i) => (
        <li
          key={`${f.url}-${i}`}
          className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2"
        >
          <div className="flex items-center gap-3 min-w-0">
            {isImageFile(f) ? (
              <button type="button" onClick={() => onPreview?.(f.url)} className="flex-shrink-0">
                <img src={f.url} alt={f.name} className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
              </button>
            ) : (
              <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-[9px] font-black uppercase">
                {(f.name?.split(".").pop() || "file").slice(0, 4)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{f.name}</p>
              {f.size ? <p className="text-[10px] text-gray-400 font-semibold">{formatBytes(f.size)}</p> : null}
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            {isImageFile(f) && onPreview ? (
              <button
                type="button"
                onClick={() => onPreview(f.url)}
                className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[10px] font-bold uppercase"
              >
                View
              </button>
            ) : (
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[10px] font-bold uppercase"
              >
                Open
              </a>
            )}
            <a
              href={f.download_url || f.url}
              download={f.name}
              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase"
            >
              Download
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

// File input that keeps the selected File objects in the parent's state.
export function FilePicker({ files, onChange, multiple = true, label = "Attach files", hint, accept = ACCEPTED_FILE_TYPES }) {
  const inputRef = useRef(null);

  const handlePick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    onChange(multiple ? [...files, ...picked] : [picked[0]]);
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-xl py-4 text-center text-[11px] font-bold text-gray-500 hover:text-blue-700 transition-all bg-gray-50"
      >
        + {label}
        {hint && <span className="block text-[10px] font-semibold text-gray-400 mt-0.5">{hint}</span>}
      </button>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} onChange={handlePick} className="hidden" />
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-[11px] font-bold text-slate-800 truncate">
                {f.name} <span className="text-gray-400 font-semibold">({formatBytes(f.size)})</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                className="text-[10px] font-bold text-red-600 hover:underline flex-shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}