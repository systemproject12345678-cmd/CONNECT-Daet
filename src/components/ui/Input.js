export default function Input({ label, ...props }) {
  return (
    <div className="w-full">
      {label && <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">{label}</label>}
      <input 
        className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-600 outline-none transition-all text-gray-900"
        {...props}
      />
    </div>
  );
}