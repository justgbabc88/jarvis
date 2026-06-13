import { BusinessCard } from "@/lib/data";
import { money, roas } from "@/lib/format";
import RadialGauge from "./RadialGauge";

function Readout({
  label,
  value,
  sub,
  frac,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  frac: number;
  tone: "accent" | "warn";
}) {
  const color = tone === "warn" ? "#ffb454" : "#2dd4ff";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="card-title">{label}</span>
        <span className="font-mono text-[11px] text-muted">{sub}</span>
      </div>
      <div className="mt-1 font-display text-xl font-semibold text-white">{value}</div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line/50">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, frac * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  );
}

export default function BusinessCardView({ b }: { b: BusinessCard }) {
  const profit = b.monthRevenueCents - b.monthSpendCents;
  const r = roas(b.monthRevenueCents, b.monthSpendCents);
  const maxv = Math.max(b.monthRevenueCents, b.monthSpendCents, 1);
  const gaugeTone = r == null ? "warn" : r >= 2 ? "good" : r >= 1 ? "accent" : "bad";
  const gaugeDisplay = r == null ? "—" : `${r.toFixed(2)}×`;
  const statusColor = b.hasSnapshots ? "#34e5b0" : "#ffb454";

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
            />
            <div className="truncate font-display text-base font-semibold tracking-wide text-white">
              {b.name}
            </div>
          </div>
          {b.description && (
            <div className="mt-0.5 truncate font-mono text-[11px] uppercase tracking-wider text-muted">
              {b.description}
            </div>
          )}
        </div>
        <RadialGauge value={r ?? 0} max={4} display={gaugeDisplay} label="ROAS" tone={gaugeTone} size={92} />
      </div>

      <div className="mt-3 space-y-3">
        <Readout
          label="Revenue · MTD"
          value={money(b.monthRevenueCents)}
          sub={`today ${money(b.todayRevenueCents)}`}
          frac={b.monthRevenueCents / maxv}
          tone="accent"
        />
        <Readout
          label="Ad spend · MTD"
          value={money(b.monthSpendCents)}
          sub={`today ${money(b.todaySpendCents)}`}
          frac={b.monthSpendCents / maxv}
          tone="warn"
        />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line/70 pt-3">
        <span className="card-title">{profit >= 0 ? "Net profit" : "Net loss"}</span>
        <span className={`font-display text-lg font-semibold ${profit >= 0 ? "text-good" : "text-bad"}`}>
          {money(Math.abs(profit))}
        </span>
      </div>
    </div>
  );
}
