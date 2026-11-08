import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 font-sans">
        {/* TOP NAVIGATION BAR */}
        <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <h1 className="text-blue-600 font-black text-xl tracking-tighter">CONNECT-Daet</h1>
            
            <nav className="hidden lg:flex items-center space-x-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              <a href="/" className="px-3 py-1 bg-blue-600 text-white rounded-md">Home</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Info</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Workflow</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Museum</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Experiences</a>
              <a href="/programs" className="px-3 py-1 text-blue-600 border-b-2 border-blue-600">Programs</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Crisis</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Shop</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Tours</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Feedback</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Analytics</a>
              <a href="#" className="px-3 py-1 hover:text-blue-600">Rewards</a>
            </nav>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}