"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function sync() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/snapshot/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sync failed");
      setMsg(`Updated ${data.updated} business${data.updated === 1 ? "" : "es"}.`);
      router.refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={sync} className="btn" disabled={busy}>
        {busy ? "Syncing…" : "↻ Sync now"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
