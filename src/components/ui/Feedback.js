"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useFeedback() {
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);
  const timer = useRef(null);

  const notify = useCallback((message, type = "info") => {
    setToast({ message, type, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setDialog(options || {});
      }),
    []
  );

  const settle = useCallback((value) => {
    if (resolver.current) resolver.current(value);
    resolver.current = null;
    setDialog(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, settle]);

  const feedbackUI = (
    <>
      {dialog && (
        <div
          className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => settle(false)}
          role="dialog"
          aria-modal="true"
          aria-label={dialog.title || "Please confirm"}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h3 className="text-base font-black text-slate-900">{dialog.title || "Are you sure?"}</h3>
              {dialog.message && <p className="text-xs text-gray-600 leading-relaxed">{dialog.message}</p>}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => settle(true)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm ${
                  dialog.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {dialog.confirmLabel || "Yes, proceed"}
              </button>
              <button
                type="button"
                onClick={() => settle(false)}
                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
              >
                {dialog.cancelLabel || "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] max-w-md w-[calc(100%-2rem)]" role="status" aria-live="polite">
          <div
            className={`flex items-start gap-3 rounded-2xl px-4 py-3 shadow-2xl text-xs font-semibold text-white border ${
              toast.type === "error"
                ? "bg-red-700 border-red-800"
                : "bg-blue-950 border-blue-800"
            }`}
          >
            <p className="flex-1 leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-white/70 hover:text-white font-bold"
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );

  return { notify, confirm, feedbackUI };
}