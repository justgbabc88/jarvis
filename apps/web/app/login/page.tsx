"use client";

import { useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || "/";
    } else {
      setError("That password didn't work.");
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/40 bg-accent/15 text-accent">
            <span className="text-lg font-bold">J</span>
          </span>
          <div className="text-lg font-semibold">Welcome back</div>
        </div>
        <label className="mb-1 block text-sm text-muted">Password</label>
        <input
          autoFocus
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="input mb-3"
          placeholder="••••••••"
        />
        {error && <p className="mb-3 text-sm text-bad">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={loading}>
          {loading ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
