export default function Button({ children, variant = "primary", className = "", ...props }) {
  const baseStyles = "px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95";
  
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100",
    secondary: "bg-white text-blue-600 border border-blue-100 hover:bg-blue-50",
    danger: "bg-red-500 text-white hover:bg-red-600",
    outline: "bg-transparent border-2 border-gray-200 text-gray-600 hover:border-blue-600 hover:text-blue-600"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}