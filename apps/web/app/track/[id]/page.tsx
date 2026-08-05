import { getTracker } from "@/lib/trackers";
import { todayYmd } from "@/lib/time";
import TrackerForm from "@/components/TrackerForm";

export const dynamic = "force-dynamic";

/** The daily log form a tracker's Slack prompt links to. */
export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tracker = await getTracker(id);

  if (!tracker || !tracker.is_active) {
    return (
      <div className="card mx-auto max-w-lg">
        <h1 className="text-xl font-semibold">Tracker not found</h1>
        <p className="mt-2 text-sm text-muted">It may have been archived. Check the dashboard.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{tracker.name}</h1>
        <p className="text-sm text-muted">
          {tracker.question || "Log today's numbers."} · {todayYmd()}
        </p>
      </div>
      <TrackerForm
        trackerId={tracker.id}
        fields={Array.isArray(tracker.fields) ? tracker.fields : []}
      />
    </div>
  );
}
