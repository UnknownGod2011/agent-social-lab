import { useMemo, useState } from "react";
import type { Agent, Department, LabEvent, Run } from "./types";
import { ARMS, money, num } from "./types";
import { GroupBars, LatencyDistribution } from "./Distribution";
import MessagePaths from "./MessagePaths";
type Award = { seq: number; points: number; optimal: boolean; cells: number };
type Row = {
  id: Department["id"];
  awards: Award[];
  calls: number;
  tokens: number;
  cost: number;
  timings: number[];
  work: number;
  social: number;
  journal: number;
  disclosed: Set<string>;
  total: number;
};
function tabulate(d: Department, events: LabEvent[], run: Run): Row {
  const r: Row = {
    id: d.id,
    awards: [],
    calls: 0,
    tokens: 0,
    cost: 0,
    timings: [],
    work: 0,
    social: 0,
    journal: 0,
    disclosed: new Set(),
    total: Number(run.metrics?.departments[d.id]?.attainable_points ?? 0),
  };
  for (const e of events) {
    if (e.department_id !== d.id) continue;
    const p = e.payload_json;
    if (e.event_type === "provider_attempt_started") r.calls++;
    if (
      ["provider_attempt_completed", "provider_attempt_failed"].includes(
        e.event_type,
      )
    ) {
      const u = (p.usage ?? p) as Record<string, unknown>;
      r.tokens += Number(
        u.total_tokens ??
          (e.input_tokens ?? 0) +
            (e.output_tokens ?? 0) +
            Number(u.thought_tokens ?? 0),
      );
      r.cost += Number(e.estimated_cost_usd ?? u.estimated_cost_usd ?? 0);
      if (typeof e.elapsed_ms === "number") r.timings.push(e.elapsed_ms);
    }
    if (e.event_type === "message_sent") {
      if (e.channel === "work") r.work++;
      if (e.channel === "small_talk") r.social++;
      if (e.channel === "notes") r.journal++;
    }
    if (e.event_type !== "action_accepted") continue;
    const task = p.task as
      | {
          scored?: boolean;
          id: string;
          review?: {
            earned_points: number;
            optimal: boolean;
            disclosed_external_cells: number;
          };
        }
      | undefined;
    const action = p.action as
      | { type?: string; suppliers?: string[] }
      | undefined;
    if (task?.scored && action?.type === "share_evidence") {
      (action.suppliers ?? []).forEach((s) =>
        r.disclosed.add([task.id, e.agent_id, s].join("/")),
      );
    }
    if (task?.scored && action?.type === "award_contract" && task.review)
      r.awards.push({
        seq: e.seq,
        points: task.review.earned_points,
        optimal: task.review.optimal,
        cells: task.review.disclosed_external_cells,
      });
  }
  return r;
}
const metrics = [
  "Decision yield",
  "Optimal awards",
  "Model calls",
  "Tokens",
  "Cost per award",
  "Execution latency",
  "Conversations",
  "Evidence",
];
export default function Analytics({
  run,
  events,
  department,
  onArm,
  onReplay,
  onAgent,
}: {
  run: Run;
  events: LabEvent[];
  department: Department;
  onArm: (id: Department["id"]) => void;
  onReplay: (n: number) => void;
  onAgent: (a: Agent) => void;
}) {
  const [metric, setMetric] = useState("Decision yield"),
    [day, setDay] = useState("all");
  const filtered = useMemo(
    () =>
      day === "all"
        ? events
        : events.filter((e) => e.virtual_day === Number(day)),
    [events, day],
  );
  const depts = Object.values(run.state?.departments ?? {}).filter(
    (d): d is Department => !!d,
  );
  const rows = useMemo(
    () => depts.map((d) => tabulate(d, filtered, run)),
    [filtered, run],
  );
  const purchase = run.config.environment === "supplier_selection_v1",
    mock = run.config.provider === "mock";
  const available = metrics.filter(
    (v) =>
      purchase ||
      ![
        "Decision yield",
        "Optimal awards",
        "Cost per award",
        "Evidence",
      ].includes(v),
  );
  const key = available.includes(metric) ? metric : available[0],
    begin = filtered[0]?.seq ?? 0,
    end = filtered.at(-1)?.seq ?? begin;
  const x = (seq: number) =>
    36 + (426 * (seq - begin)) / Math.max(1, end - begin);
  const sourceLabel = mock ? "Synthetic policy" : "Recorded model";
  function measure(r: Row) {
    switch (key) {
      case "Optimal awards":
        return r.awards.length
          ? (r.awards.filter((a) => a.optimal).length / r.awards.length) * 100
          : null;
      case "Model calls":
        return r.calls;
      case "Tokens":
        return r.tokens;
      case "Cost per award":
        return r.awards.length ? r.cost / r.awards.length : null;
      default:
        return null;
    }
  }
  const rankMax = Math.max(1, ...rows.map((r) => measure(r) ?? 0));
  return (
    <section className="analysis-section" id="analysis">
      <div className="section-head">
        <div className="section-title">
          <IconPlot />
          <h2>Run analytics</h2>
        </div>
        <select
          aria-label="Analytics day"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        >
          <option value="all">All recorded days</option>
          {Array.from({ length: run.config.days }, (_, i) => (
            <option key={i} value={i + 1}>
              Day {i + 1}
            </option>
          ))}
        </select>
      </div>
      <div className="analysis-grid">
        <article className="chart-card">
          <div className="chart-title">
            <div>
              <span className="overline">Outcomes & resources</span>
              <h3>{key}</h3>
            </div>
            <select
              aria-label="Analytics metric"
              value={key}
              onChange={(e) => setMetric(e.target.value)}
            >
              {available.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          {key === "Decision yield" ? (
            <>
              <svg
                className="yield-chart"
                viewBox="0 0 480 152"
                aria-label="Earned points as percentage of scheduled attainable points by event"
              >
                {[0, 25, 50, 75, 100].map((v) => (
                  <g key={v}>
                    <text x="0" y={126 - v + 3}>
                      {v}%
                    </text>
                    <path
                      d={`M36 ${126 - v}H465`}
                      stroke="var(--edge)"
                      strokeDasharray="3 4"
                    />
                  </g>
                ))}
                {rows.map((r, i) => {
                  let sum = 0,
                    y = 126;
                  let path = "M36 126";
                  const dots = r.awards.map((a) => {
                    sum += a.points;
                    y = 126 - (100 * sum) / Math.max(1, r.total);
                    path += ` H${x(a.seq)} V${y}`;
                    return (
                      <circle
                        key={a.seq}
                        cx={x(a.seq)}
                        cy={y}
                        r={4 + i * 0.75}
                        fill={ARMS[r.id].color}
                        stroke="var(--surface)"
                        onClick={() => onReplay(a.seq)}
                      >
                        <title>
                          Dept. {r.id}, event {a.seq}, {a.points} points
                        </title>
                      </circle>
                    );
                  });
                  return (
                    <g key={r.id}>
                      <path
                        d={path + " H462"}
                        fill="none"
                        stroke={ARMS[r.id].color}
                        strokeWidth="2"
                        strokeDasharray={
                          i === 1 ? "5 3" : i === 2 ? "2 2" : undefined
                        }
                      />
                      {dots}
                    </g>
                  );
                })}
                <text x="36" y="148">
                  Event #{begin}
                </text>
                <text x="462" y="148" textAnchor="end">
                  #{end}
                </text>
              </svg>
              <p>
                Points earned in this interval ÷ all scheduled attainable
                points.
              </p>
            </>
          ) : key === "Execution latency" ? (
            <>
              {!mock && <LatencyDistribution rows={rows} />}
              <div className="chart-rows">
                {rows.map((r) => {
                  const s = [...r.timings].sort((a, b) => a - b),
                    q = (p: number) =>
                      s.length
                        ? num(s[Math.ceil(s.length * p) - 1]) + " ms"
                        : "—";
                  return (
                    <div key={r.id}>
                      <b>Dept. {r.id}</b>
                      <span>p50 {q(0.5)}</span>
                      <span>p90 {q(0.9)}</span>
                      <span>n = {s.length}</span>
                    </div>
                  );
                })}
              </div>
              <p>
                {mock
                  ? "Offline execution. Provider latency is unavailable."
                  : "Elapsed provider attempt durations. Percentiles use nearest rank."}
              </p>
            </>
          ) : key === "Conversations" || key === "Evidence" ? (
            <>
              <GroupBars
                rows={rows.map((r) => ({
                  id: r.id,
                  values:
                    key === "Conversations"
                      ? [r.work, r.social, r.journal]
                      : [
                          r.disclosed.size,
                          r.awards.reduce((s, a) => s + a.cells, 0),
                        ],
                }))}
                series={
                  key === "Conversations"
                    ? [
                        { label: "Work", color: "var(--series-1)" },
                        { label: "Social", color: "var(--series-3)" },
                        { label: "Journal", color: "var(--series-2)" },
                      ]
                    : [
                        { label: "Disclosed", color: "var(--series-1)" },
                        { label: "Available at award", color: "var(--series-2)" },
                      ]
                }
              />
              <p>
                {key === "Evidence"
                  ? "Availability is observable. A causal measure of evidence use is unavailable."
                  : "Counts of recorded messages by channel."}
              </p>
            </>
          ) : (
            <>
              <div className="bar-stack">
                {rows.map((r) => {
                  const v = measure(r);
                  return (
                    <div key={r.id}>
                      <span>Dept. {r.id}</span>
                      <i>
                        <b
                          style={{
                            width: (100 * (v ?? 0)) / rankMax + "%",
                            background: ARMS[r.id].color,
                          }}
                        />
                      </i>
                      <strong>
                        {v === null
                          ? "—"
                          : key === "Cost per award"
                            ? money(v)
                            : num(v) + (key === "Optimal awards" ? "%" : "")}
                      </strong>
                    </div>
                  );
                })}
              </div>
              <p>
                {key === "Optimal awards"
                  ? "Optimal scored decisions ÷ scored decisions awarded."
                  : key === "Cost per award"
                    ? "Estimated usage cost in the interval ÷ scored awards."
                    : sourceLabel +
                      " · recorded attempts and usage in the selected interval."}
              </p>
            </>
          )}
          <div className="chart-legend">
            {!["Conversations", "Evidence"].includes(key) &&
              rows.map((r) => (
                <span key={r.id}>
                  <i style={{ background: ARMS[r.id].color }} />
                  Dept. {r.id}
                </span>
              ))}
            <small>n = 1 matched run</small>
          </div>
        </article>
        <article className="chart-card">
          <div className="chart-title">
            <div>
              <span className="overline">Observed interactions</span>
              <h3>Communication network</h3>
            </div>
            <select
              aria-label="Network department"
              value={department.id}
              onChange={(e) => onArm(e.target.value as Department["id"])}
            >
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  Dept. {d.id}
                </option>
              ))}
            </select>
          </div>
          <MessagePaths
            department={department}
            events={filtered}
            onAgent={onAgent}
            onReplay={onReplay}
          />
          <p>
            Lines count addressed messages, broadcasts and recorded cooperation
            uses. Dashed lines mark table talk.
          </p>
        </article>
      </div>
    </section>
  );
}
function IconPlot() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
    >
      <path d="M2 2v15h16M5 12l4-4 3 2 5-6" />
    </svg>
  );
}
