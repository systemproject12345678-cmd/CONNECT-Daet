import "./globals.css";
import "./daet-ui.css";
import { Fraunces, Figtree } from "next/font/google";
import SiteHeader from "@/components/ui/SiteHeader";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata = {
  title: "Daet Tourism Programs, Events and Activities Coordination and Management System",
  description:
    "A web-based system that helps the Municipal Tourism Office of Daet manage, organize and coordinate tourism programs, events and activities.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} min-h-screen bg-stone-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100 transition-colors`}>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}