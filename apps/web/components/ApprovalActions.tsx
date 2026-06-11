"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApprovalActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <button className="btn btn-primary" disabled={busy} onClick={() => decide("approved")}>
        Approve
      </button>
      <button className="btn text-bad" disabled={busy} onClick={() => decide("rejected")}>
        Reject
      </button>
    </div>
  );
}
