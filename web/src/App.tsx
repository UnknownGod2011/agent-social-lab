import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  controlRun,
  createRun,
  getEvents,
  getRun,
  getRuns,
  replayRun,
} from "./api";
import type { Agent, Config, LabEvent, Metrics, Run, State } from "./types";
import { DEFAULT_CONFIG, minute, money, nice, num } from "./types";
import Icon from "./Icon";
import Office, { Creature } from "./Office";
import Inspector from "./Inspector";
import type { InspectorTab } from "./Inspector";
import Compare from "./Compare";
import Experiment from "./Experiment";

type View = "lab" | "compare" | "experiment";
const phases = [
  { id: "wake", name: "Wake", icon: "sun" },
  { id: "planning", name: "Plan", icon: "board" },
  { id: "work_block_1", name: "Deep work", icon: "activity" },
  { id: "break", name: "Break", icon: "chat" },
  { id: "work_block_2", name: "Build & verify", icon: "check" },
  { id: "evaluation", name: "Evaluate", icon: "chart" },
  { id: "sleep", name: "Sleep", icon: "moon" },
];
const exports = [
  { kind: "events.jsonl", title: "Complete event log", type: "JSONL" },
  { kind: "messages.csv", title: "Conversation messages", type: "CSV" },
  { kind: "metrics.csv", title: "Recorded metrics", type: "CSV" },
  { kind: "config.json", title: "Research configuration", type: "JSON" },
];

export default function App() {
  const [view, setView] = useState<View>("lab");
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("Activity");
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [replay, setReplay] = useState<{
    state: State;
    metrics: Metrics;
    seq: number;
  } | null>(null);
  const [replaySeq, setReplaySeq] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [about, setAbout] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const booted = useRef(false);
  const activeId = useRef("");
  const replayRequest = useRef(0);

  const refreshList = useCallback(async () => {
    setRuns(await getRuns());
  }, []);
  const selectRun = useCallback(async (id: string) => {
    activeId.current = id;
    setReplay(null);
    setReplayPlaying(false);
    setSelectedAgent(null);
    setLoading(true);
    setError("");
    try {
      const [detail, trace] = await Promise.all([getRun(id), getEvents(id)]);
      if (activeId.current !== id) return;
      setRun(detail);
      setEvents(trace);
      setReplaySeq(detail.seq ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const [records, metadata] = await Promise.all([
          getRuns(),
          api<Record<string, unknown>>("/health"),
        ]);
        setHealth(metadata);
        setRuns(records);
        const initial = records[0] ?? (await createRun(DEFAULT_CONFIG));
        if (!records.length) setRuns([initial]);
        await selectRun(initial.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [selectRun]);

  useEffect(() => {
    if (!run?.id) return;
    const id = run.id;
    const source = new EventSource(
      `/api/runs/${id}/stream?after=${run.seq ?? 0}`,
    );
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      let event: LabEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (activeId.current !== id) return;
      setEvents((previous) =>
        previous.some((e) => e.seq === event.seq)
          ? previous
          : [...previous, event].sort((a, b) => a.seq - b.seq),
      );
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        getRun(id)
          .then((next) => {
            if (activeId.current === id) {
              setRun(next);
              setRuns((prior) => prior.map((r) => (r.id === id ? next : r)));
            }
          })
          .catch((e) => setError(e.message));
      }, 80);
    };
    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      setConnected(false);
    };
    // A connection lives for one selected run; native EventSource sends Last-Event-ID on reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  const onReplay = useCallback(
    (seq: number) => {
      if (!run) return;
      setReplaySeq(seq);
      setTab("Replay");
      const request = ++replayRequest.current;
      if (replayTimer.current) clearTimeout(replayTimer.current);
      replayTimer.current = setTimeout(() => {
        replayRun(run.id, seq)
          .then((result) => {
            if (replayRequest.current === request) setReplay(result);
          })
          .catch((e) => setError(e.message));
      }, 60);
    },
    [run?.id],
  );

  useEffect(() => {
    if (!replayPlaying || !run) return;
    if (replaySeq >= (run.seq ?? 0)) {
      setReplayPlaying(false);
      return;
    }
    const timer = setTimeout(() => onReplay(replaySeq + 1), 700 / replaySpeed);
    return () => clearTimeout(timer);
  }, [replayPlaying, replaySeq, replaySpeed, onReplay]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  async function command(command: string) {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const next = await controlRun(run.id, command);
      setRun(next);
      await refreshList();
      setNotice(
        command === "advance_day"
          ? "Advancing one virtual day."
          : `${nice(command)} requested.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function newRun(config: Config) {
    setBusy(true);
    setError("");
    try {
      const next = await createRun(config);
      await refreshList();
      await selectRun(next.id);
      setView("lab");
      setNotice("Experiment created. Ready when you are.");
    } finally {
      setBusy(false);
    }
  }
  async function clone() {
    if (!run) return;
    setBusy(true);
    try {
      const next = await api<Run>(`/runs/${run.id}/clone`, {});
      await refreshList();
      await selectRun(next.id);
      setView("experiment");
      setNotice("Configuration cloned into a fresh run.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const state = replay?.state ?? run?.state;
  const shownRun =
    replay && run
      ? { ...run, state: replay.state, metrics: replay.metrics }
      : run;
  const metrics = shownRun?.metrics?.departments;
  const totals = Object.values(metrics ?? {}).reduce(
    (a, m) => ({
      completed: a.completed + (m?.completed ?? 0),
      total: a.total + (m?.total ?? 0),
      calls: a.calls + (m?.model_calls ?? 0),
      tokens:
        a.tokens +
        (typeof m?.total_tokens === "number"
          ? m.total_tokens
          : (m?.input_tokens ?? 0) + (m?.output_tokens ?? 0)),
      cost:
        a.cost +
        (typeof m?.estimated_cost_usd === "number" ? m.estimated_cost_usd : 0),
      costKnown: a.costKnown && typeof m?.estimated_cost_usd === "number",
    }),
    { completed: 0, total: 0, calls: 0, tokens: 0, cost: 0, costKnown: true },
  );
  const canStart =
    !!run &&
    [
      "ready",
      "created",
      "idle",
      "paused",
      "interrupted",
      "provider_error",
      "provider_blocked",
    ].includes(run.status);
  const running =
    !!run && ["running", "waiting", "waiting_provider"].includes(run.status);
  const budget = replay ? null : run?.budget;
  const terminal =
    !!run &&
    ["completed", "stopped", "budget_exhausted", "failed"].includes(run.status);
  const live = run?.config.provider !== "mock";
  const liveReturn = () => {
    ++replayRequest.current;
    setReplay(null);
    setReplayPlaying(false);
    setReplaySeq(run?.seq ?? 0);
  };
  const activePhase = phases.findIndex((p) => p.id === state?.phase);
  const departments = Object.values(state?.departments ?? {}).filter(
    (d) => !!d,
  );
  const latestStatus = events
    .filter((event) => event.event_type === "status_changed")
    .at(-1);
  const statusReason =
    latestStatus?.payload_json.status === run?.status &&
    typeof latestStatus?.payload_json.reason === "string"
      ? latestStatus.payload_json.reason
      : "";
  const localSchedule = (timestamp: string) => {
    try {
      return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium", timeZone: run?.config.timezone ?? "Asia/Kolkata" }).format(new Date(timestamp))} · ${run?.config.timezone ?? "Asia/Kolkata"}`;
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="app-shell">
      <aside className="rail">
        <button
          className="brand-mark"
          aria-label="Beyond Task Talk home"
          onClick={() => setView("lab")}
        >
          <Icon name="flask" size={24} />
          <i />
        </button>
        <div className="rail-nav">
          {[
            { id: "lab", icon: "grid", label: "Live lab" },
            { id: "compare", icon: "chart", label: "Compare outcomes" },
            {
              id: "experiment",
              icon: "settings",
              label: "Experiment controls",
            },
          ].map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              title={n.label}
              aria-label={n.label}
              onClick={() => setView(n.id as View)}
            >
              <Icon name={n.icon} size={21} />
            </button>
          ))}
        </div>
        <button
          className="rail-about"
          title="About this research lab"
          aria-label="About this lab"
          onClick={() => setAbout(true)}
        >
          <Icon name="info" size={20} />
        </button>
        <span className="rail-version">v1</span>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="brand-wordmark">
            beyond task talk<span>RESEARCH LAB</span>
          </div>
          <nav className="main-nav" aria-label="Main navigation">
            <button
              className={view === "lab" ? "active" : ""}
              onClick={() => setView("lab")}
            >
              Live lab
            </button>
            <button
              className={view === "compare" ? "active" : ""}
              onClick={() => setView("compare")}
            >
              Compare
            </button>
            <button
              className={view === "experiment" ? "active" : ""}
              onClick={() => setView("experiment")}
            >
              Experiment
            </button>
          </nav>
          <div className="topbar-end">
            <span className="connection">
              <span className={`status-dot ${connected ? "" : "sleep"}`} />
              {connected ? "Engine connected" : "Connecting"}
            </span>
            <button
              className="profile-chip"
              aria-label="About local researcher workspace"
              onClick={() => setAbout(true)}
            >
              R<span />
            </button>
          </div>
        </header>
        <main>
          {loading && !run ? (
            <div className="loading-screen">
              <div className="loading-creatures">
                {[0, 1, 2, 3].map((i) => (
                  <Creature key={i} role={i} size={50} />
                ))}
              </div>
              <span className="eyebrow">GETTING THE LAB READY</span>
              <p>Loading recorded experiment state…</p>
            </div>
          ) : !run ? (
            <div className="connection-error">
              <Icon name="warning" size={28} />
              <h2>The lab is not connected yet.</h2>
              <p>
                {error ||
                  "Start the local FastAPI server to connect the research console."}
              </p>
              <button
                className="button primary"
                onClick={() => window.location.reload()}
              >
                Reconnect
              </button>
            </div>
          ) : (
            <>
              <div className="experiment-heading">
                <div className="heading-copy">
                  <div className="breadcrumb">
                    <span>Workspace</span>
                    <Icon name="chevron" size={11} />
                    <select
                      aria-label="Select experiment run"
                      value={run.id}
                      onChange={(e) => selectRun(e.target.value)}
                    >
                      {runs.map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.config.name} · {r.id.slice(0, 6)} · {r.status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <h1>
                    What happens between the tasks<span>?</span>
                  </h1>
                  <p>
                    {run.config.arms.length === 3 ? "Three" : "Two"} teams. The
                    same project. A different kind of break.
                  </p>
                </div>
                <div className="heading-actions">
                  <span
                    className={`badge mode-badge ${live ? "live" : "mock"}`}
                  >
                    <Icon name={live ? "wifi" : "flask"} size={13} />
                    {live ? "LIVE MODEL RUN" : "MOCK / DEMONSTRATION"}
                  </span>
                  <div className="export-wrapper">
                    <button
                      className="button secondary"
                      onClick={() => setExportOpen(!exportOpen)}
                      aria-expanded={exportOpen}
                    >
                      <Icon name="download" size={16} />
                      Export
                      <Icon name="chevron" size={12} />
                    </button>
                    {exportOpen && (
                      <div className="export-menu">
                        {exports.map((e) => (
                          <a
                            key={e.kind}
                            href={`/api/runs/${run.id}/export/${e.kind}`}
                            download
                            onClick={() => setExportOpen(false)}
                          >
                            <span>{e.title}</span>
                            <small>{e.type}</small>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {error && (
                <div className="error-box dismissible">
                  <Icon name="warning" size={17} />
                  <span>{error}</span>
                  <button
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              )}
              {view === "lab" && (
                <>
                  <div className="run-toolbar">
                    <div className="run-state">
                      <span
                        className={`status-dot ${running ? "pulsing" : terminal ? "sleep" : ""}`}
                      />
                      <strong>{replay ? "Replay" : nice(run.status)}</strong>
                      <span className="toolbar-divider" />
                      <Icon name="sun" size={16} />
                      <span>
                        Day <strong>{state?.virtual_day ?? 1}</strong> /{" "}
                        {run.config.days}
                      </span>
                      <span className="virtual-time">
                        {minute(state?.virtual_minute)} <small>VIRTUAL</small>
                      </span>
                    </div>
                    <div className="run-actions">
                      <span className="provider-name">
                        {live ? run.config.model : "Deterministic mock"}{" "}
                        <span>· seed {run.config.seed}</span>
                      </span>
                      <button
                        className="icon-button"
                        title="Clone configuration to a new experiment"
                        aria-label="Clone run"
                        disabled={busy}
                        onClick={clone}
                      >
                        <Icon name="copy" size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="Reset demo by creating a fresh offline run; history is kept"
                        aria-label="Reset demo"
                        disabled={busy}
                        onClick={() =>
                          newRun({
                            ...DEFAULT_CONFIG,
                            seed: run.config.seed,
                          }).catch((e) => setError(e.message))
                        }
                      >
                        <Icon name="reset" size={16} />
                      </button>
                      <button
                        className="icon-button stop-button"
                        aria-label="Stop experiment"
                        title={
                          terminal
                            ? "Experiment already ended"
                            : "Stop this experiment"
                        }
                        disabled={busy || terminal || run.status === "ready"}
                        onClick={() => command("stop")}
                      >
                        <Icon name="stop" size={16} />
                      </button>
                      <button
                        className="button primary play-control"
                        disabled={busy || (!running && !canStart)}
                        onClick={() =>
                          command(
                            running
                              ? "pause"
                              : run.status !== "ready"
                                ? "resume"
                                : "start",
                          )
                        }
                        title={
                          terminal
                            ? "Create or clone a run to start again"
                            : undefined
                        }
                      >
                        <Icon name={running ? "pause" : "play"} size={16} />
                        {busy
                          ? "Working…"
                          : running
                            ? "Pause"
                            : terminal
                              ? "Run finished"
                              : run.status === "ready"
                                ? "Start experiment"
                                : "Resume"}
                      </button>
                    </div>
                  </div>
                  {(statusReason ||
                    (run.status === "waiting" && run.next_due) ||
                    (run.status === "waiting_provider" && run.retry_at)) && (
                    <div
                      className={`status-details ${run.status === "provider_blocked" ? "warning" : ""}`}
                      role="status"
                    >
                      <Icon
                        name={
                          run.status === "provider_blocked"
                            ? "warning"
                            : "clock"
                        }
                        size={15}
                      />
                      <div>
                        {statusReason && (
                          <span>
                            <strong>Run status:</strong>{" "}
                            {statusReason.replaceAll("_", " ")}
                          </span>
                        )}
                        {run.status === "waiting" && run.next_due && (
                          <span>
                            <strong>Next daily wake:</strong>{" "}
                            {localSchedule(run.next_due)}
                          </span>
                        )}
                        {run.status === "waiting_provider" && run.retry_at && (
                          <span>
                            <strong>Next provider retry:</strong>{" "}
                            {localSchedule(run.retry_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="summary-strip">
                    <div>
                      <span className="summary-icon">
                        <Icon name="board" size={19} />
                      </span>
                      <span>
                        <small>Milestones passed</small>
                        <strong>
                          {totals.completed}
                          <em> / {totals.total}</em>
                        </strong>
                      </span>
                      <span className="summary-caption">
                        Across {departments.length} departments
                      </span>
                    </div>
                    <div>
                      <span className="summary-icon">
                        <Icon name="activity" size={19} />
                      </span>
                      <span>
                        <small>Model calls</small>
                        <strong>
                          {num(totals.calls)}
                          <em> / {num(run.config.max_calls)}</em>
                        </strong>
                      </span>
                    </div>
                    <div>
                      <span className="summary-icon">
                        <Icon name="chart" size={19} />
                      </span>
                      <span>
                        <small>Budget tokens</small>
                        <strong>{num(budget?.tokens ?? totals.tokens)}</strong>
                      </span>
                    </div>
                    <div>
                      <span className="summary-icon">
                        <Icon name="key" size={19} />
                      </span>
                      <span>
                        <small>Estimated cost</small>
                        <strong>
                          {budget
                            ? money(budget.estimated_cost_usd)
                            : totals.costKnown
                              ? money(totals.cost)
                              : "Unavailable"}
                        </strong>
                      </span>
                      <span className="summary-caption">
                        Cap {money(run.config.max_cost_usd)}
                      </span>
                    </div>
                  </div>
                  {replay && (
                    <div className="replay-banner">
                      <Icon name="replay" size={17} />
                      <span>
                        Viewing recorded state at event #{replay.seq}. Live
                        experiment controls remain separate.
                      </span>
                      <button onClick={liveReturn}>
                        Return to live <Icon name="arrow" size={14} />
                      </button>
                    </div>
                  )}
                  <div className="lab-layout">
                    <div className="world-column">
                      <div className="world-heading">
                        <span className="eyebrow">THE OBSERVATION ROOM</span>
                        <span>
                          <i />
                          Matched initial state{" "}
                          <code>{run.initial_state_hash?.slice(0, 8)}</code>
                        </span>
                      </div>
                      <div
                        className={`offices ${departments.length === 3 ? "three-arms" : ""}`}
                      >
                        {departments.map((d) => (
                          <Office
                            key={d.id}
                            department={d}
                            metrics={metrics?.[d.id]}
                            events={
                              replay
                                ? events.filter((e) => e.seq <= replay.seq)
                                : events
                            }
                            phase={state?.phase}
                            onAgent={(a) => {
                              setSelectedAgent(a);
                              setTab("Memory");
                            }}
                          />
                        ))}
                      </div>
                      <div className="condition-explainer">
                        <span className="explainer-icon">
                          <Icon name="flask" size={20} />
                        </span>
                        <div>
                          <strong>
                            The break changes. The work allowance doesn’t.
                          </strong>
                          <p>
                            Both teams share role templates, task requirements
                            and work turns. C adds non-task chat; A rests
                            silently.
                            {run.config.arms.includes("B")
                              ? " B journals privately to control extra calls."
                              : ""}
                          </p>
                        </div>
                        <button
                          aria-label="Open experiment design controls"
                          onClick={() => setView("experiment")}
                        >
                          <Icon name="arrow" size={19} />
                        </button>
                      </div>
                      <div className="day-panel panel">
                        <div className="day-panel-heading">
                          <div>
                            <span className="eyebrow">A DAY IN THE LAB</span>
                            <h3>Small routines. Persistent progress.</h3>
                          </div>
                          <button
                            className="text-button"
                            disabled={
                              busy ||
                              run.config.scheduler_mode !== "virtual" ||
                              running ||
                              terminal
                            }
                            title={
                              run.config.scheduler_mode !== "virtual"
                                ? "Available only in virtual-time mode"
                                : running
                                  ? "Pause before advancing one day"
                                  : terminal
                                    ? "This run has ended"
                                    : "Run until the next day boundary"
                            }
                            onClick={() => command("advance_day")}
                          >
                            Advance one day <Icon name="arrow" size={14} />
                          </button>
                        </div>
                        <div className="day-phases">
                          {phases.map((p, i) => (
                            <div
                              key={p.id}
                              className={`${i === activePhase ? "current" : ""} ${i < activePhase ? "past" : ""}`}
                            >
                              <span>
                                <Icon name={p.icon} size={17} />
                              </span>
                              <strong>{p.name}</strong>
                              {i < phases.length - 1 && <i />}
                            </div>
                          ))}
                        </div>
                        <div className="schedule-footnote">
                          <Icon name="memory" size={14} />
                          <span>
                            Board state & agent memories carry forward to the
                            next day.
                          </span>
                          <span>
                            Engine controls the schedule · scene displays it
                          </span>
                        </div>
                      </div>
                    </div>
                    {state && shownRun && (
                      <Inspector
                        run={shownRun}
                        events={
                          replay
                            ? events.filter((e) => e.seq <= replay.seq)
                            : events
                        }
                        tab={tab}
                        setTab={setTab}
                        state={state}
                        selectedAgent={selectedAgent}
                        onAgent={setSelectedAgent}
                        replaySeq={replay ? replaySeq : (run.seq ?? 0)}
                        onReplay={onReplay}
                        onLive={liveReturn}
                        replaying={!!replay}
                      />
                    )}
                  </div>
                  <section className="timeline panel">
                    <div className="timeline-heading">
                      <div>
                        <Icon name="clock" size={17} />
                        <strong>Experiment timeline</strong>
                        <span>Recorded checkpoints</span>
                      </div>
                      <div>
                        <select
                          aria-label="Replay playback speed"
                          value={replaySpeed}
                          onChange={(e) =>
                            setReplaySpeed(Number(e.target.value))
                          }
                        >
                          {[0.5, 1, 2, 4].map((n) => (
                            <option key={n} value={n}>
                              {n}× replay
                            </option>
                          ))}
                        </select>
                        <button
                          className="text-button"
                          disabled={!events.length}
                          onClick={() => {
                            if (!replay) {
                              onReplay(0);
                            }
                            setReplayPlaying(!replayPlaying);
                          }}
                        >
                          <Icon
                            name={replayPlaying ? "pause" : "play"}
                            size={13}
                          />
                          {replayPlaying ? "Pause replay" : "Play replay"}
                        </button>
                      </div>
                    </div>
                    <div className="timeline-days">
                      {Array.from({ length: run.config.days }, (_, i) => {
                        const checkpoints = events.filter(
                          (e) =>
                            e.virtual_day === i + 1 &&
                            [
                              "work_started",
                              "talk_started",
                              "sleep_started",
                              "day_completed",
                            ].includes(e.event_type),
                        );
                        return (
                          <div
                            key={i}
                            className={`timeline-day ${state?.virtual_day === i + 1 ? "current" : ""}`}
                          >
                            <div>
                              <strong>
                                DAY {String(i + 1).padStart(2, "0")}
                              </strong>
                              <span>
                                {checkpoints.length
                                  ? `${checkpoints.length} checkpoints`
                                  : "Not yet recorded"}
                              </span>
                            </div>
                            <div className="timeline-line">
                              {checkpoints.length ? (
                                checkpoints.map((e) => (
                                  <button
                                    key={e.event_id}
                                    title={`${nice(e.event_type)} · Dept. ${e.department_id ?? "All"} · #${e.seq}`}
                                    className={
                                      e.event_type.includes("talk")
                                        ? "talk"
                                        : e.event_type.includes("sleep")
                                          ? "sleep"
                                          : ""
                                    }
                                    onClick={() => onReplay(e.seq)}
                                    aria-label={`Replay day ${i + 1} ${nice(e.event_type)} event ${e.seq}`}
                                  >
                                    <Icon
                                      name={
                                        e.event_type.includes("talk")
                                          ? "chat"
                                          : e.event_type.includes("sleep")
                                            ? "moon"
                                            : e.event_type.includes("completed")
                                              ? "check"
                                              : "activity"
                                      }
                                      size={11}
                                    />
                                  </button>
                                ))
                              ) : (
                                <span className="unrecorded-line" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="timeline-scrubber">
                      <span>{replay ? `EVENT ${replaySeq}` : "LIVE EDGE"}</span>
                      <input
                        type="range"
                        min="0"
                        max={run.seq ?? 0}
                        value={replay ? replaySeq : (run.seq ?? 0)}
                        disabled={!run.seq}
                        onChange={(e) => onReplay(Number(e.target.value))}
                        aria-label="Timeline replay scrubber"
                      />
                      <span>#{run.seq ?? 0}</span>
                    </div>
                  </section>
                </>
              )}
              {view === "compare" && (
                <Compare key={run.id} run={run} runs={runs} />
              )}
              {view === "experiment" && (
                <Experiment
                  key={run.id}
                  run={run}
                  onCreate={newRun}
                  busy={busy}
                  health={health}
                />
              )}
              <footer className="page-footer">
                <span>
                  <span className="footer-mark">✳</span> Beyond Task Talk Lab{" "}
                  <span>·</span> Built for observable, reproducible experiments.
                </span>
                <button onClick={() => setAbout(true)}>
                  Research integrity <Icon name="arrow" size={12} />
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}
      {about && (
        <div className="modal-backdrop" onClick={() => setAbout(false)}>
          <section
            className="about-modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close about dialog"
              onClick={() => setAbout(false)}
            >
              <Icon name="close" size={20} />
            </button>
            <span className="eyebrow">BEYOND TASK TALK LAB</span>
            <h2 id="about-title">Curiosity, with a paper trail.</h2>
            <div className="about-creatures">
              {[0, 1, 2, 3].map((i) => (
                <Creature key={i} role={i} size={55} />
              ))}
            </div>
            <p>
              This lab compares agents that only discuss work with agents that
              also exchange non-task conversation. It measures task outcomes and
              observable cooperation, not friendship or artificial feelings.
            </p>
            <p>
              The task world is a structured milestone simulation. Mock mode is
              deterministic synthetic demonstration; live mode records real
              model responses. The animated office is a view of backend events,
              never the causal engine.
            </p>
            <div className="about-facts">
              <span>
                Seed <strong>{run?.config.seed ?? "—"}</strong>
              </span>
              <span>
                Config hash <code>{run?.config_hash?.slice(0, 16) ?? "—"}</code>
              </span>
              <span>
                Initial state{" "}
                <code>{run?.initial_state_hash?.slice(0, 16) ?? "—"}</code>
              </span>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setAbout(false);
                setView("compare");
              }}
            >
              Explore the comparison <Icon name="arrow" size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
