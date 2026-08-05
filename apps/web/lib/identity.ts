import { supabaseAdmin, supabaseConfigured } from "./supabase";

/**
 * The assistant's identity — rename Jarvis to anything from chat
 * ("rename yourself to Chad"). Applies to the web header, page title,
 * chat/voice/briefing prompts. The Slack-side display name lives in
 * Slack's app config and is changed there.
 */

export type AssistantIdentity = { name: string; tagline: string };

const DEFAULT_IDENTITY: AssistantIdentity = {
  name: "Jarvis",
  tagline: "just a rather very intelligent system",
};

export async function getAssistantIdentity(): Promise<AssistantIdentity> {
  if (!supabaseConfigured()) return DEFAULT_IDENTITY;
  try {
    const { data } = await supabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "assistant_identity")
      .maybeSingle();
    const v = (data?.value as any) || {};
    return {
      name: typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 40) : DEFAULT_IDENTITY.name,
      tagline:
        typeof v.tagline === "string" && v.tagline.trim()
          ? v.tagline.trim().slice(0, 80)
          : DEFAULT_IDENTITY.tagline,
    };
  } catch {
    return DEFAULT_IDENTITY;
  }
}
