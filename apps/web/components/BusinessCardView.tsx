import { BusinessCard } from "@/lib/data";
import { money, roas } from "@/lib/format";

export default function BusinessCardView({ b }: { b: BusinessCard }) {
  const profit = b.monthRevenueCents - b.monthSpendCents;
  const r = roas(b.monthRevenueCents, b.monthSpendCents);
  const color = (b.settings?.color as string) || "#7c5cff";

  return (
    <div className="card relative overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-semibold">{b.name}</div>
          {b.description && <div className="text-xs text-muted">{b.description}</div>}
        </div>
        {!b.hasSnapshots && <span className="pill">no data yet</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="card-title">Revenue · MTD</div>
          <div className="stat text-good">{money(b.monthRevenueCents)}</div>
          <div className="text-xs text-muted">today {money(b.todayRevenueCents)}</div>
        </div>
        <div>
          <div className="card-title">Ad spend · MTD</div>
          <div className="stat text-bad">{money(b.monthSpendCents)}</div>
          <div className="text-xs text-muted">today {money(b.todaySpendCents)}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-sm">
        <span className={profit >= 0 ? "text-good" : "text-bad"}>
          {profit >= 0 ? "Net" : "Down"} {money(Math.abs(profit))}
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">ROAS {r ? `${r.toFixed(2)}×` : "—"}</span>
      </div>
    </div>
  );
}
