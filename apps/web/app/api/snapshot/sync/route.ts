import { NextRequest, NextResponse } from "next/server";
import { syncAllBusinesses } from "@/lib/metrics";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Triggered two ways:
 *  - From the dashboard "Sync now" button (authenticated session cookie).
 *  - From the Railway worker on a schedule (Authorization: Bearer CRON_SECRET).
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization");
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (!process.env.APP_PASSWORD) return true; // open in local dev
  return isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const results = await syncAllBusinesses();
    return NextResponse.json({ ok: true, updated: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
