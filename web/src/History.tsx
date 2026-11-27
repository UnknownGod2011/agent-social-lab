import { useState } from "react";
import { api, downloadPath, hostedDemo } from "./api";
import { nice, type Run } from "./types";
import Icon from "./Icon";

const scope = hostedDemo ? "btt-review-hidden" : "btt-local-hidden";
function saved(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(scope) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
export default function History({
  runs,
  onOpen,
  onRestart,
}: {
  runs: Run[];
  onOpen: (id: string, play: boolean) => Promise<void>;
  onRestart: (run: Run) => Promise<void>;
}) {
  const [hidden, setHidden] = useState(saved),
    [archive, setArchive] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [inspect, setInspect] = useState(""),
    [audit, setAudit] = useState<{ id: string; data: unknown } | null>(null);
  function save(ids: string[]) {
    setHidden(ids);
    localStorage.setItem(scope, JSON.stringify(ids));
    setConfirm(false);
  }
  const listed = runs.filter((r) => hidden.includes(r.id) === archive),
    shown = listed.filter(
      (r) =>
        (filter === "all" ||
          (filter === "mock") === (r.config.provider === "mock")) &&
        [r.config.name, r.id, r.config.model, r.status]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  async function action(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="history-page">
      <div className="section-head">
        <div>
          <span className="overline">Workspace records</span>
          <h1>
            Run history<span>.</span>
          </h1>
          <p>
            Open a saved experiment, inspect its configuration, or replay its
            event ledger.
          </p>
        </div>
      </div>
      <div className="history-toolbar">
        <div className="segment">
          <button
            className={!archive ? "active" : ""}
            onClick={() => {
              setArchive(false);
              setConfirm(false);
            }}
          >
            Saved · {runs.filter((r) => !hidden.includes(r.id)).length}
          </button>
          <button
            className={archive ? "active" : ""}
            onClick={() => {
              setArchive(true);
              setConfirm(false);
            }}
          >
            Cleared · {runs.filter((r) => hidden.includes(r.id)).length}
          </button>
        </div>
        <input
          type="search"
          placeholder="Find a run or model"
          aria-label="Search history"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="History provider mode"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All sources</option>
          <option value="live">Live model</option>
          <option value="mock">Synthetic</option>
        </select>
        {!archive && (
          <button
            disabled={!listed.length}
            title="Clear the saved list in this browser"
            onClick={() => setConfirm(true)}
          >
            Clear history
          </button>
        )}
        {archive && (
          <button disabled={!listed.length} onClick={() => save([])}>
            Restore all
          </button>
        )}
      </div>
      {confirm && (
        <div className="history-confirm" role="alert">
          <p>
            Move all {listed.length} saved runs to Cleared in this browser? The
            original study records remain available.
          </p>
          <button
            onClick={() =>
              save([...new Set([...hidden, ...listed.map((r) => r.id)])])
            }
          >
            Confirm clear
          </button>
          <button onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {shown.map((r) => (
        <article className="record-card" key={r.id}>
          <div className="record-info">
            <span className="overline">
              {r.config.provider === "mock"
                ? "Synthetic recording"
                : "Live model recording"}{" "}
              · {r.status}
            </span>
            <h3>{r.config.name}</h3>
            <p>
              {r.created_at
                ? new Date(r.created_at).toLocaleString()
                : "Date unavailable"}{" "}
              · {r.config.model} · Seed {r.config.seed} · {r.seq ?? 0} events
            </p>
          </div>
          <div className="record-actions">
            {archive ? (
              <button onClick={() => save(hidden.filter((id) => id !== r.id))}>
                Restore run
              </button>
            ) : (
              <>
                <button
                  disabled={!!busy}
                  onClick={() => action(r.id, () => onOpen(r.id, false))}
                >
                  Open results
                </button>
                <button
                  disabled={!!busy || !r.seq}
                  onClick={() => action(r.id, () => onOpen(r.id, true))}
                >
                  <Icon name="play" size={12} /> Replay from start
                </button>
                {!hostedDemo && (
                  <button
                    disabled={!!busy}
                    title="Create a fresh run with this configuration, ready for explicit start"
                    onClick={() => action(r.id, () => onRestart(r))}
                  >
                    {r.config.provider === "mock"
                      ? "Restart as new run"
                      : "Review restart settings"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setInspect(inspect === r.id ? "" : r.id);
                    setAudit(null);
                  }}
                >
                  Technical details
                </button>
              </>
            )}
          </div>
          {inspect === r.id && !archive && (
            <div className="technical">
              <dl>
                {[
                  ["Run ID", r.id],
                  ["Configuration hash", r.config_hash],
                  ["Matched initial state", r.initial_state_hash],
                  ["Experimental arms", r.config.arms.join(" / ")],
                  ["Environment", nice(r.config.environment)],
                  ["Scheduler", r.config.scheduler_mode],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>Full configuration</summary>
                <pre>{JSON.stringify(r.config, null, 2)}</pre>
              </details>
              <div className="record-actions">
                <a
                  download
                  href={downloadPath("/runs/" + r.id + "/export/events.jsonl")}
                >
                  Export events ↗
                </a>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    action(r.id, async () => {
                      const result = await api("/runs/" + r.id + "/audit");
                      setAudit({ id: r.id, data: result });
                    })
                  }
                >
                  Read integrity audit
                </button>
              </div>
              {audit?.id === r.id && (
                <pre>{JSON.stringify(audit.data, null, 2)}</pre>
              )}
            </div>
          )}
        </article>
      ))}
      {!shown.length && (
        <div className="empty-history">
          <Icon name="clock" size={25} />
          <h3>
            {listed.length
              ? "No matching runs"
              : archive
                ? "No cleared runs"
                : "No saved runs"}
          </h3>
          <p>
            {listed.length
              ? "Try another search or source."
              : archive
                ? "Cleared records appear here for restoration."
                : "Recorded runs will appear here when available."}
          </p>
        </div>
      )}
      {hostedDemo && (
        <p className="history-footnote">
          This archive supports playback and downloads. New executions use the
          private workspace.
        </p>
      )}
    </section>
  );
}
