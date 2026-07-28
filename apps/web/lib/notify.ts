import { getProviderCreds } from "./connectors";
import { postSlack, SlackCreds } from "./connectors/slack";

/**
 * Owner notifications. Best-effort: if no Slack connection exists (or
 * the post fails) the caller carries on — notifications must never
 * break a briefing, agent run, or approval.
 */
export async function notifySlack(text: string): Promise<boolean> {
  try {
    const creds = await getProviderCreds<SlackCreds>("slack");
    if (!creds) return false;
    await postSlack(creds, text);
    return true;
  } catch (e) {
    console.error("[notify] slack post failed:", (e as Error).message);
    return false;
  }
}

/** Public URL of the app, for links in Slack messages. */
export function appUrl(path = ""): string {
  const base =
    process.env.APP_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  return base ? `${base}${path}` : "";
}
