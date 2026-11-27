import { useState } from "react";
import { ARMS, nice, type Arm, type Run } from "./types";

const resources = {
  model_calls: "Model calls",
  total_tokens: "Tokens",
  estimated_cost_usd: "Estimated cost (USD)",
  actual_cost_usd: "Reported cost (USD)",
  provider_elapsed_ms: "Execution time (ms)",
};
const fmt = (x: number, field: string) =>
  field.includes("usd")
    ? "$" + x.toLocaleString("en", { maximumFractionDigits: 6 })
    : /yield|completion/.test(field)
      ? (x * 100).toLocaleString("en", { maximumFractionDigits: 1 }) + "%"
      : x.toLocaleString("en", { maximumFractionDigits: 2 });
const numeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const ticks = [0, 0.25, 0.5, 0.75, 1];
const left = 63,
  right = 419,
  top = 20,
  bottom = 183;

export function OutcomesPlot({ runs }: { runs: Run[] }) {
  const [id, setId] = useState(""),
    [xKey, setX] = useState<keyof typeof resources>("model_calls");
  const [inspect, setInspect] = useState<Arm | null>(null);
  const run = runs.find((r) => r.id === id) ?? runs[0];
  if (!run)
    return (
      <p className="panel chart-card">
        Select a saved run to plot its conditions.
      </p>
    );
  const purchasing = run.config.environment === "supplier_selection_v1";
  const yKey = purchasing ? "decision_yield" : "completion";
  const sample = run.config.arms.map((arm) => ({
    arm,
    m: run.metrics?.departments[arm],
  }));
  const xLabel =
    xKey === "model_calls" && run.config.provider === "mock"
      ? "Synthetic calls"
      : resources[xKey];
  const series = sample.flatMap(({ arm, m }) =>
    numeric(m?.[xKey]) && numeric(m?.[yKey])
      ? [{ arm, x: m[xKey], y: m[yKey] }]
      : [],
  );
  const maximum = Math.max(0, ...series.map((s) => s.x)),
    xmax = maximum || 1;
  const clusters = new Map<string, typeof series>();
  for (const point of series) {
    const k = point.x + "/" + point.y;
    clusters.set(k, [...(clusters.get(k) ?? []), point]);
  }
  const columns = purchasing
    ? [
        "decision_yield",
        "completed",
        "disclosed_score_cells",
        "work_turns",
        "model_calls",
      ]
    : ["completion", "completed", "handoffs", "help_given", "model_calls"];
  const labels: Record<string, string> = {
    decision_yield: "Yield",
    completion: "Completion",
    completed: purchasing ? "Awards" : "Passed",
    disclosed_score_cells: "Scores shared",
    work_turns: "Work turns",
    model_calls: run.config.provider === "mock" ? "Sim. calls" : "Calls",
    help_given: "Help given",
    handoffs: "Handoffs",
  };
  return (
    <section
      className="comparison-explorer"
      aria-label="Condition comparison charts"
    >
      <div className="explorer-controls">
        <label>
          Chart run
          <select
            aria-label="Chart run"
            value={run.id}
            onChange={(e) => {
              setId(e.target.value);
              setInspect(null);
            }}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.config.name} · {r.config.seed} · {r.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {run.config.provider === "mock"
            ? "Synthetic recording"
            : run.config.model}{" "}
          · {run.status} · one team per condition
        </span>
      </div>
      <div className="explorer-grid">
        <article className="panel plot-card">
          <header>
            <div>
              <small>EFFICIENCY</small>
              <h3>Resources and outcomes</h3>
            </div>
            <select
              aria-label="Resource axis"
              value={xKey}
              onChange={(e) => setX(e.target.value as keyof typeof resources)}
            >
              {Object.entries(resources).map(([key, v]) => (
                <option value={key} key={key}>
                  {key === "model_calls" && run.config.provider === "mock"
                    ? "Synthetic calls"
                    : v}
                </option>
              ))}
            </select>
          </header>
          <p>
            {purchasing ? "Decision yield" : "Completion"} against{" "}
            {xLabel.toLowerCase()}
          </p>
          {series.length ? (
            <svg
              className="tradeoff"
              viewBox="0 0 453 224"
              role="img"
              aria-label={xLabel + " against " + labels[yKey]}
            >
              {ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={left}
                    x2={right}
                    y1={bottom - v * (bottom - top)}
                    y2={bottom - v * (bottom - top)}
                  />
                  <text
                    x={left - 8}
                    y={bottom - v * (bottom - top) + 4}
                    textAnchor="end"
                  >
                    {v * 100}%
                  </text>
                  {(maximum > 0 || v === 0) && (
                    <>
                      <line
                        x1={left + v * (right - left)}
                        x2={left + v * (right - left)}
                        y1={top}
                        y2={bottom}
                        strokeDasharray="2 5"
                      />
                      <text
                        x={left + v * (right - left)}
                        y={bottom + 17}
                        textAnchor="middle"
                      >
                        {fmt(v * xmax, xKey)}
                      </text>
                    </>
                  )}
                </g>
              ))}
              {[...clusters.values()].map((points) => {
                const p = points[0],
                  n = points.length;
                return (
                  <g
                    key={p.x + "/" + p.y}
                    transform={`translate(${left + (p.x / xmax) * (right - left)} ${bottom - p.y * (bottom - top)})`}
                  >
                    <title>
                      {points.map((pt) => pt.arm).join(" / ")} ·{" "}
                      {fmt(p.x, xKey)} · {fmt(p.y, yKey)}
                    </title>
                    <circle r={9.5} fill="#192333" />
                    {points.map((pt, i) => (
                      <circle
                        key={pt.arm}
                        r={6.8}
                        fill="none"
                        stroke={ARMS[pt.arm].color}
                        strokeWidth={5}
                        strokeDasharray={
                          n === 1
                            ? undefined
                            : `${(2 * Math.PI * 6.8) / n} ${2 * Math.PI * 6.8 * (1 - 1 / n)}`
                        }
                        transform={`rotate(${(i * 360) / n - 90})`}
                      />
                    ))}
                  </g>
                );
              })}
              <text x={(left + right) / 2} y="220" textAnchor="middle">
                {xLabel}
              </text>
            </svg>
          ) : (
            <div className="plot-empty">
              {xKey === "actual_cost_usd" ? "The provider did not report a charge for this run." : "No paired resource and outcome measurements are available."}
            </div>
          )}
          <div className="plot-key">
            {sample.map(({ arm }) => (
              <button
                key={arm}
                aria-pressed={inspect === arm}
                onClick={() => setInspect(inspect === arm ? null : arm)}
              >
                <i style={{ background: ARMS[arm].color }} />
                {arm} · {ARMS[arm].title}
              </button>
            ))}
          </div>
          <p className="plot-note">
            {inspect
              ? (() => {
                  const p = series.find((s) => s.arm === inspect);
                  return p
                    ? inspect +
                        " · " +
                        fmt(p.x, xKey) +
                        " " +
                        xLabel.toLowerCase() +
                        " · " +
                        fmt(p.y, yKey) +
                        " " +
                        labels[yKey].toLowerCase()
                    : inspect + " · No paired measurements";
                })()
              : "Segments in one marker indicate teams with identical coordinates."}
          </p>
        </article>
        <article className="panel plot-card">
          <header>
            <div>
              <small>CONDITION PROFILE</small>
              <h3>Outcomes and work by team</h3>
            </div>
          </header>
          <p>Each column uses its own unit and scale.</p>
          <div className="profile-scroll">
            <table className="profile-map">
              <thead>
                <tr>
                  <th>Team</th>
                  {columns.map((c) => (
                    <th key={c}>{labels[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.map(({ arm, m }) => (
                  <tr key={arm}>
                    <th style={{ color: ARMS[arm].color }}>{arm}</th>
                    {columns.map((c) => {
                      const val = m?.[c];
                      const all = sample.map((s) => s.m?.[c]).filter(numeric);
                      const max = Math.max(0, ...all);
                      return (
                        <td
                          key={c}
                          title={arm + " · " + labels[c]}
                          style={
                            numeric(val)
                              ? {
                                  background: `rgba(90,169,184,${0.09 + (max ? val / max : 0) * 0.42})`,
                                }
                              : undefined
                          }
                        >
                          {numeric(val) ? fmt(val, c) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="plot-note">
            Darker to lighter fills show zero to the largest observed value
            within a column. A dash denotes a missing measurement.
          </p>
        </article>
      </div>
    </section>
  );
}

export function SpreadPlot({
  rows,
  parameter,
}: {
  rows: { arm: Arm; n: number; mean: number | null; sd: number | null }[];
  parameter: string;
}) {
  const values = rows.filter((r): r is typeof r & { mean: number } =>
    numeric(r.mean),
  );
  if (!values.length) return null;
  const lo = Math.min(0, ...values.map((r) => r.mean - (r.sd ?? 0))),
    hi = Math.max(0, ...values.map((r) => r.mean + (r.sd ?? 0)));
  const xpos = (x: number) => 63 + (hi === lo ? 0 : (x - lo) / (hi - lo)) * 345;
  const end = rows.length * 33 + 18;
  return (
    <svg
      className="spread-plot"
      viewBox={`0 0 470 ${end + 31}`}
      role="img"
      aria-label={
        "Condition means and sample standard deviations for " + nice(parameter)
      }
    >
      {[lo, ...(hi > lo ? [(lo + hi) / 2, hi] : [])].map((v) => (
        <g key={v}>
          <line x1={xpos(v)} y1="7" x2={xpos(v)} y2={end} />
          <text x={xpos(v)} y={end + 18} textAnchor="middle">
            {fmt(v, parameter)}
          </text>
        </g>
      ))}
      {rows.map(({ arm, mean, sd, n }, i) => {
        const y = i * 33 + 19;
        return (
          <g key={arm}>
            <text x="13" y={y + 4} fill={ARMS[arm].color}>
              {arm}
            </text>
            <text x="465" y={y + 4} textAnchor="end">
              n={n}
            </text>
            {numeric(mean) && (
              <>
                <title>
                  {arm +
                    " · " +
                    fmt(mean, parameter) +
                    (numeric(sd) ? " ± " + fmt(sd, parameter) + " SD" : "")}
                </title>
                {numeric(sd) && (
                  <path
                    stroke={ARMS[arm].color}
                    strokeWidth="2"
                    d={`M${xpos(mean - sd)} ${y - 5}v10m0 -5H${xpos(mean + sd)}m0 -5v10`}
                  />
                )}
                <circle cx={xpos(mean)} cy={y} r="5.5" fill={ARMS[arm].color} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
