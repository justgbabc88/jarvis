import { NextRequest, NextResponse } from "next/server";
import { listLeads, leadsToCsv } from "@/lib/leads";
import { todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

/** CSV download — opens straight in Google Sheets or Excel. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") || undefined;
  const leads = await listLeads({ status, limit: 5000 });
  return new NextResponse(leadsToCsv(leads), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-leads-${todayYmd()}.csv"`,
    },
  });
}
