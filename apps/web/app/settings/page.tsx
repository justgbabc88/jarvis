"use client";

import { useEffect, useState } from "react";

type Business = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  settings: Record<string, any>;
};

export default function SettingsPage() {
  const [items, setItems] = useState<Business[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [adAccount, setAdAccount] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/businesses");
    const data = await res.json();
    setItems(data.businesses || []);
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
          Add or remove a business anytime — it’s a setting, not code. Nothing is hardcoded.
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
            <div key={b.id} className="card flex items-center justify-between">
              <div>
                <div className="font-medium">
                  {b.name} {!b.is_active && <span className="pill ml-2">hidden</span>}
                </div>
                {b.description && <div className="text-xs text-muted">{b.description}</div>}
                {b.settings?.meta?.ad_account_id && (
                  <div className="text-xs text-muted">Meta: {b.settings.meta.ad_account_id}</div>
                )}
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
          ))
        )}
      </div>
    </div>
  );
}
