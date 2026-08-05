import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getAssistantIdentity } from "@/lib/identity";

export async function generateMetadata(): Promise<Metadata> {
  const id = await getAssistantIdentity();
  return {
    title: id.name,
    description: "A single snapshot of your businesses — and agents that do the work.",
  };
}

const nav = [
  { href: "/", label: "Snapshot" },
  { href: "/goals", label: "Goals" },
  { href: "/agents", label: "Agents" },
  { href: "/approvals", label: "Approvals" },
  { href: "/connections", label: "Connections" },
  { href: "/settings", label: "Settings" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const id = await getAssistantIdentity();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Share+Tech+Mono&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <div className="mx-auto max-w-6xl px-5 py-6">
          <header className="mb-8 flex items-center justify-between border-b border-line/70 pb-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="reactor">
                <span className="reactor-core">{id.name.charAt(0).toUpperCase()}</span>
              </span>
              <div>
                <div className="font-display text-lg font-bold tracking-[0.28em] text-white">
                  {id.name.toUpperCase()}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent/70">
                  {id.tagline}
                </div>
              </div>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted transition hover:bg-accent/10 hover:text-accent"
                >
                  {n.label}
                </Link>
              ))}
              <span className="ml-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-good">
                <span className="h-1.5 w-1.5 rounded-full bg-good shadow-[0_0_8px_2px_rgba(52,229,176,0.7)] animate-flicker" />
                online
              </span>
            </nav>
          </header>
          {children}
          <footer className="mt-16 flex flex-wrap items-center gap-x-2 border-t border-line/70 pt-5 font-mono text-[11px] uppercase tracking-wider text-muted">
            <span className="text-accent/70">// sys</span>
            online · vercel · railway · supabase · claude · voice runs in-browser
          </footer>
        </div>
      </body>
    </html>
  );
}
