import { DateRange, RevenueResult, toCents } from "./types";

/**
 * NMI (Network Merchants) revenue via the Query API.
 *   https://secure.nmi.com/api/query.php
 *
 * We pull settled/captured sales minus refunds for the date range and
 * roll them up by day. The full XML is returned as `raw` for auditing.
 *
 * Auth: a gateway "security key". Stored encrypted per connection, or
 * falls back to NMI_SECURITY_KEY for single-tenant/local use.
 */

const NMI_QUERY_URL = "https://secure.nmi.com/api/query.php";

// NMI wants timestamps as YYYYMMDDhhmmss in the gateway's timezone.
function stamp(ymd: string, end = false): string {
  const compact = ymd.replace(/-/g, "");
  return end ? `${compact}235959` : `${compact}000000`;
}

// Tiny, dependency-free extraction of repeated <tag>…</tag> values.
function tagValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

function splitTransactions(xml: string): string[] {
  return tagValues(xml, "transaction");
}

function dayOf(isoish: string): string {
  // NMI date strings are either "2026-06-10 14:03:55" or compact "20260610140355".
  const m = isoish.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const c = isoish.match(/^(\d{4})(\d{2})(\d{2})/);
  if (c) return `${c[1]}-${c[2]}-${c[3]}`;
  return isoish.slice(0, 10);
}

export type NmiCreds = { security_key: string };

/**
 * Split one gateway across businesses by matching the payer. `match` is a
 * case-insensitive substring tested against each transaction's company /
 * name / email / order description.
 *   include → keep ONLY transactions that match (empty match keeps nothing)
 *   exclude → drop transactions that match (empty match keeps everything)
 */
export type NmiFilter = { mode: "include" | "exclude"; match: string };

export function nmiCredsFromEnv(): NmiCreds | null {
  const k = process.env.NMI_SECURITY_KEY;
  return k ? { security_key: k } : null;
}

export async function fetchNmiRevenue(
  creds: NmiCreds,
  range: DateRange,
  filter?: NmiFilter | null
): Promise<RevenueResult> {
  const params = new URLSearchParams({
    security_key: creds.security_key,
    report_type: "transaction",
    start_date: stamp(range.since),
    end_date: stamp(range.until, true),
  });

  const res = await fetch(NMI_QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`NMI query failed: HTTP ${res.status}`);
  }
  const xml = await res.text();
  if (/<error_response>/i.test(xml) || /Authentication Failed/i.test(xml)) {
    throw new Error(`NMI error: ${tagValues(xml, "error_response")[0] || "authentication failed"}`);
  }

  const needle = filter?.match.trim().toLowerCase() || "";

  const byDayMap = new Map<string, number>();
  let totalCents = 0;

  for (const tx of splitTransactions(xml)) {
    const type = (tagValues(tx, "type")[0] || tagValues(tx, "action_type")[0] || "").toLowerCase();
    const condition = (tagValues(tx, "condition")[0] || "").toLowerCase();
    const amountStr = tagValues(tx, "amount")[0] || tagValues(tx, "settle_amount")[0] || "0";
    const dateStr = tagValues(tx, "transaction_date")[0] || tagValues(tx, "date")[0] || range.since;

    // Per-business payer filter (split a shared gateway between businesses).
    if (filter) {
      const hay = [
        tagValues(tx, "company")[0],
        tagValues(tx, "first_name")[0],
        tagValues(tx, "last_name")[0],
        tagValues(tx, "email")[0],
        tagValues(tx, "order_description")[0],
        tagValues(tx, "shipping_company")[0],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (filter.mode === "include") {
        if (!needle || !hay.includes(needle)) continue; // include nothing until a match is set
      } else if (needle && hay.includes(needle)) {
        continue; // exclude matches
      }
    }

    // Skip abandoned/declined; count settled or pending-settlement money.
    const counts = ["complete", "settled", "pendingsettlement", "pending_settlement"].includes(condition);
    if (!counts) continue;

    let cents = toCents(amountStr);
    if (type.includes("refund") || type.includes("credit")) cents = -cents;
    else if (!type.includes("sale") && !type.includes("capture") && !type.includes("auth")) {
      continue; // ignore voids etc.
    }

    const day = dayOf(dateStr);
    byDayMap.set(day, (byDayMap.get(day) || 0) + cents);
    totalCents += cents;
  }

  const byDay = [...byDayMap.entries()]
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalCents, byDay, raw: { transactions: splitTransactions(xml).length } };
}
