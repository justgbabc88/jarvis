import { NextRequest, NextResponse } from "next/server";
import { fetchNmiRevenue } from "@/lib/connectors/nmi";
import { fetchMetaSpend } from "@/lib/connectors/meta";
import { verifyEmail } from "@/lib/connectors/email";
import { fetchTodayEvents } from "@/lib/connectors/calendar";
import { verifyClickUp, fetchDueTasks } from "@/lib/connectors/clickup";
import { nDaysAgoYmd, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Live "does this credential work?" check, run before saving a connection.
 * Hits the real provider for a tiny recent window and reports back.
 */
export async function POST(req: NextRequest) {
  const { provider, credentials } = await req.json().catch(() => ({}));
  const range = { since: nDaysAgoYmd(7), until: todayYmd() };
  try {
    if (provider === "nmi") {
      const r = await fetchNmiRevenue(credentials, range);
      return NextResponse.json({
        ok: true,
        message: `Connected. Found activity totaling $${(r.totalCents / 100).toFixed(2)} in the last 7 days.`,
      });
    }
    if (provider === "meta") {
      const s = await fetchMetaSpend(credentials, range);
      return NextResponse.json({
        ok: true,
        message: `Connected. $${(s.totalCents / 100).toFixed(2)} ad spend in the last 7 days.`,
      });
    }
    if (provider === "email") {
      await verifyEmail(credentials);
      return NextResponse.json({
        ok: true,
        message: `Connected. SMTP login works — approved emails will send from ${credentials.from || credentials.username}.`,
      });
    }
    if (provider === "calendar_ics") {
      const events = await fetchTodayEvents(credentials);
      return NextResponse.json({
        ok: true,
        message: `Connected. ${events.length} event${events.length === 1 ? "" : "s"} on today's calendar.`,
      });
    }
    if (provider === "clickup") {
      const who = await verifyClickUp(credentials);
      const tasks = await fetchDueTasks(credentials);
      return NextResponse.json({
        ok: true,
        message: `Connected as ${who}. ${tasks.length} task${tasks.length === 1 ? "" : "s"} due today or overdue.`,
      });
    }
    return NextResponse.json({ ok: true, message: "Saved (no live test for this provider yet)." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e.message }, { status: 400 });
  }
}
