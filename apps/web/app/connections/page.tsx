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

const PROVIDERS: Record<string, { label: string; fields: { key: string; label: string; placeholder?: string }[] }> = {
  nmi: {
    label: "NMI — revenue",
    fields: [{ key: "security_key", label: "Gateway security key", placeholder: "nmi security key" }],
  },
  meta: {
    label: "Meta — ad spend",
    fields: [
      { key: "access_token", label: "Access token", placeholder: "long-lived token" },
      { key: "ad_account_id", label: "Ad account id", placeholder: "act_1234567890" },
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
    await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        label: label.trim() || PROVIDERS[provider].label,
        credentials: creds,
        config: {},
      }),
    });
    setLabel("");
    setCreds({});
    setTestMsg("");
    setBusy(false);
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
        <div className="flex gap-2">
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
              type={f.key.includes("token") || f.key.includes("key") ? "password" : "text"}
              value={creds[f.key] || ""}
              placeholder={f.placeholder}
              onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
            />
          </div>
        ))}

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
