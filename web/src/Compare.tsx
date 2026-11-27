import { OutcomesPlot, SpreadPlot } from "./ComparePlots";
import { useEffect, useState } from "react";
import { api, downloadPath } from "./api";
import type { Arm, Run } from "./types";
import { ARMS, money, nice, num } from "./types";
import { CooperationGraph, MetricsView } from "./Inspector";
import Icon from "./Icon";

type MetricSummary = { n: number; mean: number | null; sd: number | null };
type Summary = {
  configuration_group: string;
  provider: string;
  departments: Partial<
    Record<
      Arm,
      {
        n: number;
        mean_milestones: number | null;
        sd_milestones: number | null;
        metrics?: Record<string, MetricSummary>;
      }
    >
  >;
};
export default function Compare({ run, runs }: { run: Run; runs: Run[] }) {
  const [selected, setSelected] = useState<string[]>([run.id]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [comparison, setComparison] = useState<Run[]>([run]);
  const [parameter, setParameter] = useState("completed");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selected.length) {
      setSummary([]);
      setComparison([]);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ runs: Run[]; summary: Summary[] }>(
      `/compare?ids=${selected.join(",")}`,
    )
      .then((r) => {
        if (!cancelled) {
          setSummary(r.summary);
          setComparison(r.runs);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setSummary([]);
          setComparison([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, run]);
  const arms = run.config.arms;
  const purchasing = run.config.environment === "supplier_selection_v1";
  const metricKeys = [
    ...new Set([
      "completed",
      ...summary.flatMap((group) =>
        Object.values(group.departments).flatMap((department) =>
          Object.keys(department?.metrics ?? {}),
        ),
      ),
    ]),
  ];
  const label = (field: string) =>
    ({
      completed: purchasing ? "Scored tenders awarded" : "Milestones passed",
      estimated_cost_usd: "Estimated cost (USD)",
      actual_cost_usd: "Provider-reported cost (USD)",
      duplicate_claims_prevented: "Duplicate claims prevented",
    })[field] ?? nice(field);
  const format = (value: number) =>
    parameter.includes("cost")
      ? money(value)
      : parameter === "completion" || parameter.endsWith("yield")
        ? `${(value * 100).toFixed(1)}%`
        : num(value);
  const stats = (mean: number | null, sd: number | null) =>
    mean === null
      ? "No reported data"
      : `${format(mean)}${sd === null ? " · variability unavailable" : ` ± ${format(sd)} SD`}`;
  return (
    <div className="compare-page">
      <div className="comparison-notice">
        <Icon name="flask" size={19} />
        <p>
          Each department contributes one team-run per experiment. Small samples
          and synthetic runs cannot establish a treatment effect.
        </p>
      </div>
      <OutcomesPlot runs={comparison} />
      <div className="comparison-bottom">
        <section className="panel compare-table">
          <div className="section-heading">
            <div>
              <span className="eyebrow">CURRENT PAIRED RUN</span>
              <h3>All recorded parameters</h3>
            </div>
            <a
              className="text-button"
              href={downloadPath(`/runs/${run.id}/export/metrics.csv`)}
              download
            >
              <Icon name="download" size={14} /> CSV
            </a>
          </div>
          <MetricsView run={run} />
        </section>
        <section className="panel cooperation-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">BEHAVIORAL PROXIES</span>
              <h3>
                {purchasing
                  ? "Evidence at the decision"
                  : "Cooperation, observed"}
              </h3>
            </div>
            <Icon name="link" size={18} />
          </div>
          <p>
            {purchasing
              ? "Compare evidence made available to the chair with the number of optimal awards."
              : "Edges represent validated help, handoffs and repairs."}
          </p>
          {arms.map((a) => (
            <div className="graph-section" key={a}>
              <div>
                <span className="arm-tag" style={{ color: ARMS[a].color }}>
                  {a}
                </span>
                <strong>{ARMS[a].title}</strong>
              </div>
              {purchasing ? (
                <p>
                  {num(run.metrics?.departments[a]?.external_scores_at_award)}{" "}
                  outside-role scores visible at award ·{" "}
                  {num(run.metrics?.departments[a]?.optimal_decisions)} optimal
                  awards
                </p>
              ) : (
                <CooperationGraph
                  edges={
                    (run.metrics?.departments[a]?.cooperation_edges ?? []) as {
                      source: string;
                      target: string;
                      count: number;
                    }[]
                  }
                  arm={a}
                />
              )}
            </div>
          ))}
        </section>
      </div>
      <section className="panel replications-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ACROSS RUNS</span>
            <h3>Replications & variability</h3>
          </div>
          {loading && <span className="help-text">Loading recorded runs…</span>}
        </div>
        <p className="help-text">
          Select runs to inspect every parameter, means and sample standard
          deviation. The backend groups compatible configurations; only
          completed runs enter summaries. Repeating one deterministic seed does
          not create independent evidence.
        </p>
        <div className="run-picks">
          {runs.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                disabled={!selected.includes(r.id) && selected.length >= 20}
                title={
                  selected.length >= 20
                    ? "Compare up to 20 recorded runs at a time"
                    : undefined
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, r.id]
                      : selected.filter((id) => id !== r.id),
                  )
                }
              />
              <span>
                {r.config.name}
                <small>
                  {r.config.provider} · seed {r.config.seed} · {r.status}
                </small>
              </span>
            </label>
          ))}
        </div>
        {!!comparison.length && (
          <>
            <div className="matrix-heading">
              <span className="eyebrow">
                SELECTED RUNS · CONFIGURATION & RECORDED OUTCOMES
              </span>
              <span>Scroll horizontally for all parameters →</span>
            </div>
            <div
              className="run-matrix-scroll"
              tabIndex={0}
              role="region"
              aria-label="Selected run comparison table, horizontally scrollable"
            >
              <table className="run-matrix">
                <thead>
                  <tr>
                    <th>Run / condition</th>
                    <th>Provider / model</th>
                    <th>Seed</th>
                    <th>Schedule / days</th>
                    <th>Work rounds / block</th>
                    <th>Hard budget caps</th>
                    <th>Milestones</th>
                    <th>API attempts</th>
                    <th>Total tokens</th>
                    <th>Estimated USD</th>
                    <th>Provider-reported USD</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.flatMap((record) =>
                    record.config.arms.map((arm) => {
                      const m = record.metrics?.departments[arm];
                      return (
                        <tr key={`${record.id}-${arm}`}>
                          <td>
                            <strong>{record.config.name}</strong>
                            <span>
                              {record.id.slice(0, 8)} · Dept. {arm} ·{" "}
                              {nice(record.status)}
                            </span>
                          </td>
                          <td>
                            {record.config.provider}
                            <span>{record.config.model}</span>
                          </td>
                          <td>{record.config.seed}</td>
                          <td>
                            {nice(record.config.scheduler_mode)} ·{" "}
                            {record.config.days} days
                            <span>Arms {record.config.arms.join(" / ")}</span>
                          </td>
                          <td>
                            {record.config.work_rounds}
                            <span>
                              Break every {record.config.talk_frequency} day(s)
                              · {record.config.break_length} min
                            </span>
                          </td>
                          <td>
                            {num(record.config.max_calls)} attempts
                            <span>
                              {num(record.config.max_tokens)} tokens ·{" "}
                              {money(record.config.max_cost_usd)}
                            </span>
                          </td>
                          <td>
                            {num(m?.completed)} / {num(m?.total)}
                          </td>
                          <td>{num(m?.model_calls)}</td>
                          <td>{num(m?.total_tokens)}</td>
                          <td>{money(m?.estimated_cost_usd)}</td>
                          <td>{money(m?.actual_cost_usd)}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
            <details className="configuration-details">
              <summary>Inspect full recorded configurations and hashes</summary>
              <p className="help-text">
                Includes role prompts, model, seed, schedule, limits and all
                condition settings. API credentials are never part of a run
                configuration.
              </p>
              <pre>
                {JSON.stringify(
                  comparison.map((record) => ({
                    run_id: record.id,
                    status: record.status,
                    config_hash: record.config_hash,
                    initial_state_hash: record.initial_state_hash,
                    config: record.config,
                  })),
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
        )}
        {error && <div className="error-box">{error}</div>}
        <label className="comparison-parameter">
          Aggregate parameter
          <select
            aria-label="Parameter to compare across runs"
            value={parameter}
            onChange={(e) => setParameter(e.target.value)}
          >
            {metricKeys.map((key) => (
              <option key={key} value={key}>
                {label(key)}
              </option>
            ))}
          </select>
        </label>
        {summary.map((group) => (
          <div key={group.configuration_group} className="replication-group">
            <span className="section-label">
              {group.provider.toUpperCase()} · CONFIG{" "}
              {group.configuration_group.slice(0, 10)}
            </span>
            <SpreadPlot
              parameter={parameter}
              rows={(Object.keys(group.departments) as Arm[]).map((arm) => {
                const d = group.departments[arm]!;
                const item =
                  d.metrics?.[parameter] ??
                  (parameter === "completed"
                    ? { n: d.n, mean: d.mean_milestones, sd: d.sd_milestones }
                    : { n: 0, mean: null, sd: null });
                return { arm, ...item };
              })}
            />
            <small>
              Dots show means. Whiskers show one sample standard deviation where
              repeated measurements exist.
            </small>
            <div className="replication-stats">
              {(Object.keys(group.departments) as Arm[]).map((a) => {
                const department = group.departments[a]!;
                const s =
                  department.metrics?.[parameter] ??
                  (parameter === "completed"
                    ? {
                        n: department.n,
                        mean: department.mean_milestones,
                        sd: department.sd_milestones,
                      }
                    : { n: 0, mean: null, sd: null });
                return (
                  <div key={a}>
                    <span style={{ color: ARMS[a].color }}>Department {a}</span>
                    <strong>{stats(s.mean, s.sd)}</strong>
                    <small>
                      {label(parameter)} · n = {s.n} completed team runs with
                      data
                    </small>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="inline-note">
          <Icon name="info" size={15} />
          <span>
            No p-values are computed for demonstration data. Missing provider
            charges stay unreported. Live studies need predeclared outcomes,
            sufficient independent replications and a justified analysis plan.
          </span>
        </div>
      </section>
    </div>
  );
}
