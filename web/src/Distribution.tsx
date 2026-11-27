import type { Arm } from "./types";
import { ARMS } from "./types";

export function LatencyDistribution({
  rows,
}: {
  rows: { id: Arm; timings: number[] }[];
}) {
  const all = rows.flatMap((r) => r.timings);
  if (!all.length)
    return <p>No provider timings were recorded in this interval.</p>;
  const max = all.reduce((a, b) => Math.max(a, b), 0),
    width = Math.max(1, Math.ceil(max / 6)),
    bins = rows.map((r) => {
      const values = Array<number>(6).fill(0);
      for (const ms of r.timings) values[Math.min(5, Math.floor(ms / width))]++;
      return values;
    });
  const highest = Math.max(1, ...bins.flat());
  return (
    <svg
      className="distribution"
      viewBox="0 0 440 145"
      role="img"
      aria-label="Provider attempt latency histogram, six bins in milliseconds"
    >
      {[0, 0.5, 1].map((k) => (
        <g key={k}>
          <path
            d={`M25 ${112 - 83 * k}h400`}
            stroke="#384357"
            strokeDasharray="3 5"
          />
          <text x="3" y={115 - 83 * k}>
            {Math.round(k * highest)}
          </text>
        </g>
      ))}
      {Array.from({ length: 6 }, (_, b) => (
        <g key={b}>
          {rows.map((r, i) => {
            const v = bins[i][b],
              bw = 40 / rows.length;
            return (
              <rect
                key={r.id}
                x={34 + b * 65 + i * bw}
                y={112 - (83 * v) / highest}
                width={bw - 1}
                height={(83 * v) / highest}
                fill={ARMS[r.id].color}
              >
                <title>
                  Dept. {r.id} · {b * width}–{(b + 1) * width} ms · {v} attempts
                </title>
              </rect>
            );
          })}
          <text x={32 + b * 65} y="131">
            {b * width} ms
          </text>
        </g>
      ))}
    </svg>
  );
}
export function GroupBars({
  rows,
  series,
}: {
  rows: { id: Arm; values: number[] }[];
  series: { label: string; color: string }[];
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  return (
    <div className="group-chart">
      {rows.map((r) => (
        <div key={r.id} className="group-plot">
          <b>Dept. {r.id}</b>
          <div>
            {r.values.map((v, i) => (
              <div className="group-track" key={i}>
                <i
                  style={{
                    width: (100 * v) / max + "%",
                    background: series[i].color,
                  }}
                />
                <small>{v}</small>
                <span className="sr-only">{series[i].label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="chart-series">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
