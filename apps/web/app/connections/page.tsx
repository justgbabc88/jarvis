"use client";

import { useEffect, useState } from "react";

type Connection = {
  id: string;
  provider: string;
  label: string;
  status: string;
  last_error: string | null;
  created_at: string;
};

const PROVIDERS: Record<
  string,
  { label: string; hint?: string; fields: { key: string; label: string; placeholder?: string }[] }
> = {
  nmi: {
    label: "NMI — revenue",
    fields: [{ key: "security_key", label: "Gateway security key", placeholder: "nmi security key" }],
  },
  meta: {
    label: "Meta — ad spend",
    hint: "Also powers approved ad budget changes.",
    fields: [
      { key: "access_token", label: "Access token", placeholder: "long-lived token" },
      { key: "ad_account_id", label: "Ad account id", placeholder: "act_1234567890" },
    ],
  },
  clickup: {
    label: "ClickUp — tasks",
    fields: [
      { key: "api_token", label: "Personal API token", placeholder: "pk_… (ClickUp → Settings → Apps → API Token)" },
    ],
  },
  google_calendar: {
    label: "Google Calendar",
    fields: [
      {
        key: "ics_url",
        label: "Secret iCal URL",
        placeholder: "https://calendar.google.com/calendar/ical/…/basic.ics",
      },
    ],
  },
  slack: {
    label: "Slack",
    hint: "Webhook = briefings, reports, tracker prompts & approval cards. Add the bot token + signing secret to also DM Jarvis questions and tap Approve/Reject in Slack (see DEPLOY.md → Slack).",
    fields: [
      { key: "webhook_url", label: "Incoming webhook URL", placeholder: "https://hooks.slack.com/services/…" },
      { key: "bot_token", label: "Bot token (optional, for chat)", placeholder: "xoxb-…" },
      { key: "signing_secret", label: "Signing secret (optional, for chat + buttons)", placeholder: "Slack app → Basic Information" },
    ],
  },
  email: {
    label: "Email — send (SMTP)",
    hint: "Used ONLY to send emails you've approved. Gmail: smtp.gmail.com + an app password.",
    fields: [
      { key: "host", label: "SMTP host", placeholder: "smtp.gmail.com" },
      { key: "port", label: "Port", placeholder: "587" },
      { key: "username", label: "Username", placeholder: "you@yourdomain.com" },
      { key: "password", label: "Password / app password" },
      { key: "from", label: "From address (optional)", placeholder: "defaults to username" },
    ],
  },
};

export default function ConnectionsPage() {
  const [items, setItems] = useState<Connection[]>([]);
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>("nmi");
  const [label, setLabel] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [testMsg, setTestMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cuLists, setCuLists] = useState<{ id: string; name: string }[]>([]);
  const [cuListsMsg, setCuListsMsg] = useState("");

  async function loadClickUpLists() {
    if (!creds.api_token) {
      setCuListsMsg("Enter your API token first.");
      return;
    }
    setBusy(true);
    setCuListsMsg("Loading lists…");
    const res = await fetch("/api/connections/clickup-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_token: creds.api_token }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.lists) {
      setCuLists(data.lists);
      setCuListsMsg(`${data.lists.length} list(s) found.`);
    } else {
      setCuListsMsg(data.error || "Couldn't load lists.");
    }
  }

  async function load() {
    const res = await fetch("/api/connections");
    const data = await res.json();
    setItems(data.connections || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function test() {
    setBusy(true);
    setTestMsg("");
    const res = await fetch("/api/connections/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, credentials: creds }),
    });
    const data = await res.json();
    setTestMsg(data.message);
    setBusy(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        label: label.trim() || PROVIDERS[provider].label,
        credentials: creds,
        config: {},
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const err = res ? await res.json().catch(() => ({})) : {};
      setTestMsg(
        `⚠ Save failed: ${typeof err.error === "string" ? err.error : JSON.stringify(err.error || "network error")}`
      );
      return; // keep the form so nothing typed is lost
    }
    setLabel("");
    setCreds({});
    setTestMsg("✓ Saved.");
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this connection?")) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="text-sm text-muted">
          Connect the tools that feed your snapshot and power your agents. Credentials are
          encrypted before they’re stored.
        </p>
      </div>

      <form onSubmit={save} className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(PROVIDERS).map(([key, p]) => (
            <button
              type="button"
              key={key}
              onClick={() => {
                setProvider(key as keyof typeof PROVIDERS);
                setCreds({});
                setTestMsg("");
              }}
              className={`btn ${provider === key ? "btn-primary" : ""}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {PROVIDERS[provider].hint && <p className="text-xs text-muted">{PROVIDERS[provider].hint}</p>}

        <div>
          <label className="mb-1 block text-sm text-muted">Label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={PROVIDERS[provider].label}
          />
        </div>

        {PROVIDERS[provider].fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-sm text-muted">{f.label}</label>
            <input
              className="input"
              type={
                f.key.includes("token") || f.key.includes("key") || f.key.includes("password")
                  ? "password"
                  : "text"
              }
              value={creds[f.key] || ""}
              placeholder={f.placeholder}
              onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
            />
          </div>
        ))}

        {provider === "clickup" && (
          <div>
            <label className="mb-1 block text-sm text-muted">Pull tasks from</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input max-w-xs"
                value={creds.list_id || ""}
                onChange={(e) => {
                  const list = cuLists.find((l) => l.id === e.target.value);
                  const next = { ...creds };
                  if (list) {
                    next.list_id = list.id;
                    next.list_name = list.name;
                  } else {
                    delete next.list_id;
                    delete next.list_name;
                  }
                  setCreds(next);
                }}
              >
                <option value="">All lists (tasks assigned to me)</option>
                {cuLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={loadClickUpLists} disabled={busy}>
                Load lists
              </button>
              {cuListsMsg && <span className="text-xs text-muted">{cuListsMsg}</span>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={test} disabled={busy}>
            Test
          </button>
          <button className="btn btn-primary" disabled={busy}>
            Save connection
          </button>
          {testMsg && <span className="text-xs text-muted">{testMsg}</span>}
        </div>
      </form>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted">No connections yet.</p>
        ) : (
          items.map((c) => (
            <div key={c.id} className="card flex items-center justify-between">
              <div>
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-muted">
                  {c.provider} ·{" "}
                  <span className={c.status === "connected" ? "text-good" : "text-bad"}>{c.status}</span>
                  {c.last_error ? ` · ${c.last_error}` : ""}
                </div>
              </div>
              <button className="btn text-bad" onClick={() => remove(c.id)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
