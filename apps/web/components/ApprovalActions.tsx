"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApprovalActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    const res = await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json().catch(() => ({}));
    if (decision === "approved" && data.execution) {
      // Show the execution outcome briefly before the row disappears.
      setResult(data.execution);
      setTimeout(() => router.refresh(), 2500);
    } else {
      router.refresh();
    }
    setBusy(false);
  }

  if (result) {
    return (
      <span
        className={`text-sm ${
          result.status === "executed" ? "text-good" : result.status === "failed" ? "text-bad" : "text-muted"
        }`}
      >
        {result.status === "executed" ? "✓ " : result.status === "failed" ? "✕ " : ""}
        {result.message}
      </span>
    );
  }

  return (
    <div className="flex gap-2">
      <button className="btn btn-primary" disabled={busy} onClick={() => decide("approved")}>
        {busy ? "Working…" : "Approve & run"}
      </button>
      <button className="btn text-bad" disabled={busy} onClick={() => decide("rejected")}>
        Reject
      </button>
    </div>
  );
}
