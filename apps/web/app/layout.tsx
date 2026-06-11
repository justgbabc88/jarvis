import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Jarvis",
  description: "A single snapshot of your businesses — and agents that do the work.",
};

const nav = [
  { href: "/", label: "Snapshot" },
  { href: "/goals", label: "Goals" },
  { href: "/agents", label: "Agents" },
  { href: "/approvals", label: "Approvals" },
  { href: "/connections", label: "Connections" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <div className="mx-auto max-w-6xl px-5 py-6">
          <header className="mb-8 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/40 bg-accent/15 text-accent shadow-glow">
                <span className="text-lg font-bold">J</span>
              </span>
              <div>
                <div className="text-lg font-semibold leading-none">Jarvis</div>
                <div className="text-xs text-muted">your businesses, at a glance</div>
              </div>
            </Link>
            <nav className="hidden gap-1 sm:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-panel2 hover:text-white"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>
          {children}
          <footer className="mt-16 border-t border-line pt-5 text-xs text-muted">
            Jarvis · built on Vercel + Railway + Supabase + Claude · voice is free (your browser)
          </footer>
        </div>
      </body>
    </html>
  );
}
