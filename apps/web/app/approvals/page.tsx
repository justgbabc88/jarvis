import { getPendingApprovals } from "@/lib/data";
import { money } from "@/lib/format";
import ApprovalActions from "@/components/ApprovalActions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const approvals = await getPendingApprovals();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted">
          The safety gate. Anything an agent wants to send, post, delete, or spend waits here for you.
        </p>
      </div>

      {approvals.length === 0 ? (
        <div className="card text-sm text-muted">Nothing waiting. You’re all clear.</div>
      ) : (
        <div className="space-y-3">
          {approvals.map((a: any) => (
            <div key={a.id} className="card flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="pill uppercase">{a.kind}</span>
                  <span className="font-medium">{a.title}</span>
                  {a.amount_cents != null && (
                    <span className="text-sm text-warn">{money(a.amount_cents)}</span>
                  )}
                </div>
                {a.detail && <p className="mt-1 text-sm text-muted">{a.detail}</p>}
              </div>
              <ApprovalActions id={a.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
