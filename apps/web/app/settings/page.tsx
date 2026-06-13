"use client";

import { useEffect, useState } from "react";

type Business = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  settings: Record<string, any>;
};

type Connection = {
  id: string;
  provider: string;
  label: string;
  status: string;
};

/**
 * Per-business connection assignment. Stored in business.settings as
 *   { nmi: { connection_id }, meta: { connection_id, ad_account_id } }
 * connection_id: undefined = auto (only when a single connection of that
 * provider exists), "none" = detached, otherwise a connections.id.
 */
function BusinessConnections({
  b,
  connections,
  onSaved,
}: {
  b: Business;
  connections: Connection[];
  onSaved: () => void;
}) {
  const [nmiId, setNmiId] = useState<string>(b.settings?.nmi?.connection_id || "");
  const [metaId, setMetaId] = useState<string>(b.settings?.meta?.connection_id || "");
  const [adAccount, setAdAccount] = useState<string>(b.settings?.meta?.ad_account_id || "");
  const [nmiFilterMode, setNmiFilterMode] = useState<string>(b.settings?.nmi?.filter?.mode || "none");
  const [nmiFilterMatch, setNmiFilterMatch] = useState<string>(b.settings?.nmi?.filter?.match || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const nmiOptions = connections.filter((c) => c.provider === "nmi");
  const metaOptions = connections.filter((c) => c.provider === "meta");

  async function save() {
    setSaving(true);
    const settings = { ...(b.settings || {}) };
    settings.nmi = { ...(settings.nmi || {}) };
    settings.meta = { ...(settings.meta || {}) };
    if (nmiId) settings.nmi.connection_id = nmiId;
    else delete settings.nmi.connection_id;
    if (nmiFilterMode === "include" || nmiFilterMode === "exclude") {
      settings.nmi.filter = { mode: nmiFilterMode, match: nmiFilterMatch.trim() };
    } else {
      delete settings.nmi.filter;
    }
    if (metaId) settings.meta.connection_id = metaId;
    else delete settings.meta.connection_id;
    if (adAccount.trim()) settings.meta.ad_account_id = adAccount.trim();
    else delete settings.meta.ad_account_id;
    if (Object.keys(settings.nmi).length === 0) delete settings.nmi;
    if (Object.keys(settings.meta).length === 0) delete settings.meta;

    await fetch(`/api/businesses/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-muted">NMI (revenue)</label>
          <select className="input" value={nmiId} onChange={(e) => setNmiId(e.target.value)}>
            <option value="">Auto (if only one)</option>
            <option value="none">None</option>
            {nmiOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Meta (ad spend)</label>
          <select className="input" value={metaId} onChange={(e) => setMetaId(e.target.value)}>
            <option value="">Auto (if only one)</option>
            <option value="none">None</option>
            {metaOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Meta ad account id(s) — comma-separated to combine</label>
          <input
            className="input"
            value={adAccount}
            onChange={(e) => setAdAccount(e.target.value)}
            placeholder="act_123, act_456"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <div>
          <label className="mb-1 block text-xs text-muted">NMI payer filter (split a shared gateway)</label>
          <select
            className="input"
            value={nmiFilterMode}
            onChange={(e) => setNmiFilterMode(e.target.value)}
          >
            <option value="none">No filter (all transactions)</option>
            <option value="include">Only include payers matching…</option>
            <option value="exclude">Exclude payers matching…</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Payer / company contains</label>
          <input
            className="input"
            value={nmiFilterMatch}
            onChange={(e) => setNmiFilterMatch(e.target.value)}
            placeholder="e.g. Londen Leads"
            disabled={nmiFilterMode === "none"}
          />
        </div>
        <div className="flex sm:justify-end">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [items, setItems] = useState<Business[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [adAccount, setAdAccount] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [bRes, cRes] = await Promise.all([fetch("/api/businesses"), fetch("/api/connections")]);
    const bData = await bRes.json();
    const cData = await cRes.json();
    setItems(bData.businesses || []);
    setConnections(cData.connections || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const settings: Record<string, any> = {};
    if (adAccount.trim()) settings.meta = { ad_account_id: adAccount.trim() };
    await fetch("/api/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: desc.trim() || undefined, settings }),
    });
    setName("");
    setDesc("");
    setAdAccount("");
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this business? Its metrics history will be deleted.")) return;
    await fetch(`/api/businesses/${id}`, { method: "DELETE" });
    load();
  }

  async function toggle(b: Business) {
    await fetch(`/api/businesses/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !b.is_active }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Businesses</h1>
        <p className="text-sm text-muted">
          Add or remove a business anytime — it’s a setting, not code. Attach each business to its
          own connections so revenue and spend never mix.
        </p>
      </div>

      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-muted">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Londen Leads" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted">Description (optional)</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Lead-gen agency" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted">Meta ad account id (optional)</label>
          <input className="input" value={adAccount} onChange={(e) => setAdAccount(e.target.value)} placeholder="act_1234567890" />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary">Add business</button>
        </div>
      </form>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No businesses yet.</p>
        ) : (
          items.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {b.name} {!b.is_active && <span className="pill ml-2">hidden</span>}
                  </div>
                  {b.description && <div className="text-xs text-muted">{b.description}</div>}
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => toggle(b)}>
                    {b.is_active ? "Hide" : "Show"}
                  </button>
                  <button className="btn text-bad" onClick={() => remove(b.id)}>
                    Remove
                  </button>
                </div>
              </div>
              <BusinessConnections b={b} connections={connections} onSaved={load} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
