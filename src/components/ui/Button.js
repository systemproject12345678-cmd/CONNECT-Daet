export default function Button({ children, variant = "primary", className = "", ...props }) {
  const baseStyles =
    "px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants = {
    primary:
      "bg-slate-700 text-stone-50 hover:bg-slate-800 shadow-stone-200/70 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white dark:shadow-none",
    secondary:
      "bg-stone-100 text-slate-800 border border-stone-300 hover:bg-stone-200/80 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700 dark:shadow-none",
    danger:
      "bg-rose-800/90 text-rose-50 hover:bg-rose-900 shadow-stone-200/70 dark:bg-rose-950/85 dark:text-rose-200 dark:border dark:border-rose-800/70 dark:hover:bg-rose-900 dark:shadow-none",
    outline:
      "bg-transparent border-2 border-stone-300 text-slate-700 hover:border-slate-600 hover:bg-stone-100/70 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
    success:
      "bg-teal-700/90 text-teal-50 hover:bg-teal-800 shadow-stone-200/70 dark:bg-teal-900/60 dark:text-teal-200 dark:border dark:border-teal-800 dark:hover:bg-teal-900 dark:shadow-none",
    warning:
      "bg-amber-100/90 text-amber-900 border border-amber-200 hover:bg-amber-200/80 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70 dark:hover:bg-amber-900/70 dark:shadow-none",
  };

  const selectedVariant = variants[variant] || variants.primary;

  return (
    <button
      className={`${baseStyles} ${selectedVariant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}