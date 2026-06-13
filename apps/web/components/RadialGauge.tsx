type Tone = "accent" | "good" | "bad" | "warn";

const TONES: Record<Tone, string> = {
  accent: "#2dd4ff",
  good: "#34e5b0",
  bad: "#ff5d6c",
  warn: "#ffb454",
};

/**
 * A JARVIS-style radial diagnostic: a 270° arc gauge ringed with tick marks
 * that light up to the current value, with the reading in the center.
 */
export default function RadialGauge({
  value,
  max = 1,
  display,
  label,
  tone = "accent",
  size = 100,
}: {
  value: number;
  max?: number;
  display: string;
  label?: string;
  tone?: Tone;
  size?: number;
}) {
  const r = 40;
  const C = 2 * Math.PI * r;
  const span = 0.75; // 270° sweep, 90° gap at the bottom
  const frac = Math.max(0, Math.min(value / max, 1));
  const color = TONES[tone];
  const ticks = 36;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {Array.from({ length: ticks }).map((_, i) => {
          const t = i / (ticks - 1);
          const angle = 135 + t * 270;
          const lit = t <= frac;
          return (
            <line
              key={i}
              x1="50"
              y1="6"
              x2="50"
              y2="11"
              stroke={lit ? color : "rgba(45,212,255,0.18)"}
              strokeWidth="1.4"
              transform={`rotate(${angle} 50 50)`}
              style={lit ? { filter: `drop-shadow(0 0 2px ${color})` } : undefined}
            />
          );
        })}
        <g transform="rotate(135 50 50)">
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="rgba(45,212,255,0.10)"
            strokeWidth="5"
            strokeDasharray={`${span * C} ${C}`}
            strokeLinecap="round"
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${frac * span * C} ${C}`}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <div className="font-display text-lg font-bold text-white">{display}</div>
          {label && (
            <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.2em] text-accent/70">
              {label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
