import TechHeading from "./TechHeading";
import { ProfileOrb, WorkspaceAtmosphere } from "./Atmosphere";
import { useTheme } from "./theme";
import { ReplayBuffer } from "./replayBuffer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  controlRun,
  createRun,
  downloadPath,
  getEvents,
  getRun,
  getRuns,
  hostedDemo,
} from "./api";
import type {
  Agent,
  Arm,
  Config,
  LabEvent,
  Metrics,
  Run,
  State,
} from "./types";
import { DEFAULT_CONFIG, minute, money, nice, num } from "./types";
import Icon from "./Icon";
import Creature from "./Creature";
import Deck from "./world/Deck";
import Analytics from "./Analytics";
import History from "./History";
import TeamReadout from "./TeamReadout";
import Inspector from "./Inspector";
import type { InspectorTab } from "./Inspector";
import Compare from "./Compare";
import Experiment from "./Experiment";
import Studies from "./Studies";
import "./research.css";

type View = "history" | "lab" | "compare" | "experiment" | "studies";
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
  const [view, setView] = useState<View>(
    !hostedDemo && location.hash === "#experiment"
      ? "experiment"
      : location.hash === "#history"
        ? "history"
        : location.hash === "#studies"
          ? "studies"
          : location.hash === "#compare"
            ? "compare"
            : "lab",
  );
  const { theme, nextTheme, toggleTheme } = useTheme();
  const [arm, setArm] = useState<Arm>("C");
  const [filterArm, setFilterArm] = useState<Arm>("C");
  const [notebookKey, setNotebookKey] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<InspectorTab>(
    location.hash === "#conversations" ? "Conversations" : "Activity",
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [replay, setReplay] = useState<{
    state: State;
    metrics: Metrics;
    seq: number;
  } | null>(null);
  const [replaySeq, setReplaySeq] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(hostedDemo ? 4 : 1);
  const [about, setAbout] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const booted = useRef(false);
  const activeId = useRef("");
  const replayRequest = useRef(0);
  const frames = useRef<ReplayBuffer | null>(null);
  const lastDisplayed = useRef(0);
  const transcriptLink = useRef(location.hash === "#conversations");

  useEffect(() => {
    if (!loading && run && transcriptLink.current) {
      transcriptLink.current = false;
      document.getElementById("notebook")?.scrollIntoView({ block: "start" });
    }
  }, [loading, run]);

  useEffect(() => {
    function openRegistry() {
      const page = location.hash.slice(1);
      if (
        ["lab", "compare", "studies", "history"].includes(page) ||
        (!hostedDemo && page === "experiment")
      )
        setView(page as View);
    }
    window.addEventListener("hashchange", openRegistry);
    return () => window.removeEventListener("hashchange", openRegistry);
  }, []);

  const refreshList = useCallback(async () => {
    setRuns(await getRuns());
  }, []);
  const selectRun = useCallback(
    async (id: string, opening = false, play = false) => {
      activeId.current = id;
      const buffer = new ReplayBuffer(id);
      frames.current = buffer;
      replayRequest.current++;
      if (replayTimer.current) clearTimeout(replayTimer.current);
      setReplay(null);
      setReplayPlaying(false);
      setSelectedAgent(null);
      setLoading(true);
      setError("");
      try {
        const detail = await getRun(id);
        const trace = await getEvents(id, detail.seq ?? 0);
        if (activeId.current !== id) return;
        const defaultArm = detail.config.arms.includes("C")
          ? "C"
          : detail.config.arms[0];
        const workView =
          new URLSearchParams(location.search).get("moment") === "work";
        const checkpoint =
          opening && workView
            ? (trace.find(
                (e) =>
                  e.department_id === defaultArm &&
                  e.event_type === "work_started" &&
                  e.agent_id?.endsWith("-verifier"),
              ) ??
              trace.find(
                (e) =>
                  e.department_id === defaultArm &&
                  e.event_type === "work_started",
              ))
            : opening && hostedDemo
              ? trace.find(
                  (e) =>
                    e.channel === "small_talk" &&
                    e.event_type === "message_sent",
                )
              : undefined;
        const entry = play
          ? await buffer.read(0)
          : checkpoint
            ? await buffer.read(checkpoint.seq)
            : null;
        if (activeId.current !== id) return;
        setArm(defaultArm);
        setFilterArm(defaultArm);
        setNotebookKey((k) => k + 1);
        localStorage.setItem("btt-selected-run", id);
        if (!opening) {
          const url = new URL(location.href);
          if (url.searchParams.has("run")) {
            url.searchParams.set("run", id);
            window.history.replaceState(null, "", url);
          }
        }
        setRun(detail);
        setEvents(trace);
        lastDisplayed.current = entry?.seq ?? detail.seq ?? 0;
        setReplay(entry);
        setReplayPlaying(play);
        setReplaySeq(entry?.seq ?? detail.seq ?? 0);
      } catch (e) {
        if (activeId.current === id) {
          setRun(null);
          setEvents([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (activeId.current === id) setLoading(false);
      }
    },
    [],
  );
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
        const requested = new URLSearchParams(location.search).get("run");
        const initial = records.find((r) => r.id === requested) ??
          records.find(
            (r) => r.id === localStorage.getItem("btt-selected-run"),
          ) ?? records[0];
        if (initial) await selectRun(initial.id, true);
        else setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [selectRun]);

  useEffect(() => {
    if (!run?.id || hostedDemo) return;
    const id = run.id;
    const source = new EventSource(
      `/api/runs/${id}/stream?after=${run.seq ?? 0}`,
    );
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    let alive = true,
      fetching = false,
      dirty = false;
    function scheduleRefresh() {
      if (!alive || fetching || refreshTimer.current) return;
      refreshTimer.current = setTimeout(async () => {
        refreshTimer.current = null;
        fetching = true;
        dirty = false;
        try {
          const next = await getRun(id);
          if (alive && activeId.current === id) {
            setRun((current) =>
              current?.id === id && (current.seq ?? 0) > (next.seq ?? 0)
                ? current
                : next,
            );
            setRuns((prior) => prior.map((r) => (r.id === id ? next : r)));
          }
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        } finally {
          fetching = false;
          if (dirty) scheduleRefresh();
        }
      }, 100);
    }
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
      dirty = true;
      scheduleRefresh();
    };
    return () => {
      alive = false;
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      setConnected(false);
    };
    // A connection lives for one selected run; native EventSource sends Last-Event-ID on reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  const onReplay = useCallback((seq: number, debounce = false) => {
    const buffer = frames.current;
    if (!buffer) return;
    const request = ++replayRequest.current;
    if (replayTimer.current) clearTimeout(replayTimer.current);
    setReplaySeq(seq);
    const show = (frame: Awaited<ReturnType<ReplayBuffer["read"]>>) => {
      lastDisplayed.current = frame.seq;
      setReplay(frame);
    };
    const cached = buffer.peek(seq);
    if (cached) {
      show(cached);
      return;
    }
    const fetchFrame = () =>
      buffer
        .read(seq)
        .then((frame) => {
          if (request === replayRequest.current) show(frame);
        })
        .catch((e) => {
          if (request !== replayRequest.current) return;
          setError(e.message);
          setReplayPlaying(false);
          setReplaySeq(lastDisplayed.current);
        });
    if (debounce) replayTimer.current = setTimeout(fetchFrame, 45);
    else void fetchFrame();
  }, []);

  useEffect(() => {
    if (!replayPlaying || !replay || !run) return;
    let cancelled = false;
    void frames.current?.warm(replay.seq, run.seq ?? 0, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [replayPlaying, replay?.seq, run?.id, run?.seq]);
  useEffect(() => {
    if (!replayPlaying || !run || !replay || replay.seq !== replaySeq) return;
    if (replaySeq >= (run.seq ?? 0)) {
      setReplayPlaying(false);
      return;
    }
    const timer = setTimeout(() => onReplay(replaySeq + 1), 700 / replaySpeed);
    return () => clearTimeout(timer);
  }, [replayPlaying, replaySeq, replay, replaySpeed, onReplay]);
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
      navigate("lab");
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
      navigate("experiment");
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
    if (replayTimer.current) clearTimeout(replayTimer.current);
    setReplay(null);
    setReplayPlaying(false);
    setReplaySeq(run?.seq ?? 0);
  };
  const visibleEvents = useMemo(
    () => events.filter((e) => e.seq <= (replay?.seq ?? run?.seq ?? 0)),
    [events, replay?.seq, run?.seq],
  );
  const notebook = (which: InspectorTab) => {
    setTab(which);
    setFilterArm(arm);
    setNotebookKey((k) => k + 1);
    requestAnimationFrame(() =>
      document.querySelector("#notebook")?.scrollIntoView({ block: "start" }),
    );
  };
  const inspectEvent = (seq: number) => {
    onReplay(seq);
    setTab("Replay");
    requestAnimationFrame(() =>
      document.querySelector("#notebook")?.scrollIntoView({ block: "start" }),
    );
  };
  const historyPage = (
    <History
      runs={runs}
      onOpen={async (id, play) => {
        await selectRun(id, false, play);
        navigate("lab");
      }}
      onRestart={async (original) => {
        if (original.config.provider !== "mock") {
          await selectRun(original.id);
          navigate("experiment");
          return;
        }
        const fresh = await api<Run>("/runs/" + original.id + "/clone", {});
        await refreshList();
        await selectRun(fresh.id);
        navigate("lab");
        setNotice("Fresh run ready. Start when you are ready to record.");
      }}
    />
  );
  function navigate(next: View) {
    setView(next);
    location.hash = next;
    window.scrollTo(0, 0);
  }
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
          title="Observation deck"
          aria-label="Beyond Task Talk home"
          onClick={() => navigate("lab")}
        >
          <Icon name="orbit" size={29} />
        </button>
        <nav className="rail-nav" aria-label="Main navigation">
          {[
            {
              id: "lab",
              label: "Lab",
              icon: "station",
              title: "Observe the department",
            },
            {
              id: "compare",
              label: "Compare",
              icon: "chart",
              title: "Compare matched runs",
            },
            {
              id: "history",
              label: "History",
              icon: "clock",
              title: "Replay or manage saved runs",
            },
            {
              id: "studies",
              label: "Studies",
              icon: "board",
              title: "Open study registry",
            },
            ...(!hostedDemo
              ? [
                  {
                    id: "experiment",
                    label: "Controls",
                    icon: "settings",
                    title: "Configure experiments",
                  },
                ]
              : []),
          ].map((n) => (
            <button
              key={n.id}
              aria-current={view === n.id ? "page" : undefined}
              className={view === n.id ? "active" : ""}
              title={n.title}
              onClick={() => navigate(n.id as View)}
            >
              <Icon name={n.icon} size={20} />
              <small>{n.label}</small>
            </button>
          ))}
        </nav>
        <button
          className="rail-about"
          aria-label="About this lab"
          title="Research information"
          onClick={() => setAbout(true)}
        >
          <Icon name="info" size={20} />
        </button>
      </aside>
      <div className="main-shell">
        <WorkspaceAtmosphere theme={theme} />
        <header className="topbar">
          <div className="brand-wordmark">
            beyond task talk<span>RESEARCH LAB</span>
          </div>
          {run && (
            <div className="run-locator">
              {" "}
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
            </div>
          )}
          <div className="topbar-end">
            <button className="theme-toggle" onClick={toggleTheme}
              aria-label={`Switch to ${nextTheme} mode`}
              title={`Switch to ${nextTheme} mode`}>
              <Icon name={nextTheme === "light" ? "sun" : nextTheme === "blue" ? "orbit" : "moon"} size={15} />
              <span>{theme === "blue" ? "Classic blue" : theme === "light" ? "Light" : "Dark"}</span>
            </button>
            <span className="connection">
              <span
                className={`status-dot ${connected || hostedDemo ? "" : "sleep"}`}
              />
              {hostedDemo
                ? "Replay archive"
                : connected
                  ? "Engine connected"
                  : "Connecting"}
            </span>
            <ProfileOrb theme={theme} open={() => setAbout(true)} />
          </div>
        </header>
        <main>
          {loading ? (
            <div className="loading-screen">
              <div className="loading-creatures">
                {[0, 1, 2, 3].map((i) => (
                  <Creature key={i} role={i} size={50} />
                ))}
              </div>
              <span className="eyebrow">GETTING THE LAB READY</span>
              <p>Loading recorded experiment state…</p>
            </div>
          ) : view === "history" && !error ? (
            historyPage
          ) : !run ? (
            view === "experiment" && !hostedDemo ? (
              <Experiment
                run={null}
                onCreate={newRun}
                busy={busy}
                health={health}
              />
            ) : view === "studies" && !error ? (
              <Studies
                openRun={async (id) => {
                  await refreshList();
                  await selectRun(id);
                  navigate("lab");
                }}
              />
            ) : (
              <div className="connection-error">
                <Icon name="warning" size={28} />
                <h2>
                  {error
                    ? "Unable to load the workspace"
                    : "No recorded experiments"}
                </h2>
                <p>{error || "This workspace has no run to inspect yet."}</p>
                {error ? (
                  <button
                    className="button primary"
                    onClick={() => window.location.reload()}
                  >
                    Reconnect
                  </button>
                ) : (
                  !hostedDemo && (
                    <button
                      className="button primary"
                      onClick={() => navigate("experiment")}
                    >
                      Configure an experiment
                    </button>
                  )
                )}
              </div>
            )
          ) : (
            <>
              {view !== "studies" && (
                <div className="experiment-heading">
                  <div className="heading-copy">
                    <TechHeading
                      theme={theme}
                      text={
                        view === "lab"
                          ? "Observation deck"
                          : view === "compare"
                            ? "Run comparison"
                            : "Experiment controls"
                      }
                    />
                    <p>
                      {run.config.environment === "supplier_selection_v1"
                        ? "Select the best supplier using four private scorecards."
                        : "Deliver a task board against machine-checked milestones."}{" "}
                      <span>
                        {" "}
                        {run.config.arms.length} matched departments.
                      </span>
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
                              href={downloadPath(
                                `/runs/${run.id}/export/${e.kind}`,
                              )}
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
              )}
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
                      <strong>
                        {replay ? "Recorded replay" : nice(run.status)}
                      </strong>
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
                      {hostedDemo ? (
                        <button
                          className="button primary play-control"
                          onClick={() => {
                            if (replayPlaying) {
                              setReplayPlaying(false);
                            } else {
                              if (!replay || replaySeq >= (run.seq ?? 0))
                                onReplay(0);
                              setReplayPlaying(true);
                            }
                          }}
                        >
                          <Icon
                            name={replayPlaying ? "pause" : "play"}
                            size={16}
                          />
                          {replayPlaying
                            ? "Pause replay"
                            : replay
                              ? "Play replay"
                              : "Watch experiment"}
                        </button>
                      ) : (
                        <>
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
                            disabled={
                              busy || terminal || run.status === "ready"
                            }
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
                        </>
                      )}
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
                  {state && shownRun && (
                    <Deck
                      key={"room-" + run.id}
                      state={state}
                      run={shownRun}
                      seq={replay?.seq ?? run.seq ?? 0}
                      events={visibleEvents}
                      arm={arm}
                      onArm={(id) => {
                        setArm(id);
                        setFilterArm(id);
                        setNotebookKey((k) => k + 1);
                      }}
                      selected={selectedAgent}
                      onPick={setSelectedAgent}
                      open={notebook}
                      onReplay={inspectEvent}
                    />
                  )}
                  {shownRun && (
                    <TeamReadout
                      run={shownRun}
                      seq={replay?.seq ?? run.seq ?? 0}
                    />
                  )}
                  {budget && budget.uncertain_attempts > 0 && (
                    <div className="inline-note">
                      Budget reservations include {budget.uncertain_attempts}{" "}
                      uncertain attempts · {num(budget.tokens)} tokens ·{" "}
                      {money(budget.estimated_cost_usd)} estimated.
                    </div>
                  )}
                  {replay && (
                    <div className="replay-banner">
                      <Icon name="replay" size={15} />
                      <span>
                        Recorded state · Event #{replay.seq} of {run.seq}
                      </span>
                      <button onClick={liveReturn}>
                        {hostedDemo ? "Return to results" : "Return to live"}{" "}
                        <Icon name="arrow" size={13} />
                      </button>
                    </div>
                  )}
                  <section className="timeline panel">
                    <div className="timeline-heading">
                      <div>
                        <Icon name="clock" size={17} />
                        <strong>Experiment timeline</strong>
                        <span>Recorded checkpoints</span>
                      </div>
                      <div>
                        <select
                          aria-label="Jump to phase"
                          value=""
                          onChange={(e) => {
                            if (e.target.value)
                              onReplay(Number(e.target.value), true);
                          }}
                        >
                          <option value="">Jump to phase</option>
                          {events
                            .filter((e) => e.event_type === "phase_started")
                            .map((e) => (
                              <option key={e.seq} value={e.seq}>
                                Day {e.virtual_day} ·{" "}
                                {phases.find(
                                  (p) => p.id === e.payload_json.phase,
                                )?.name ?? nice(e.payload_json.phase)}
                              </option>
                            ))}
                        </select>
                        {!hostedDemo && (
                          <button
                            className="text-button"
                            disabled={
                              busy ||
                              run.config.scheduler_mode !== "virtual" ||
                              running ||
                              terminal
                            }
                            title={
                              terminal
                                ? "Run finished"
                                : running
                                  ? "Pause first"
                                  : "Advance a virtual day"
                            }
                            onClick={() => command("advance_day")}
                          >
                            Advance one day
                          </button>
                        )}
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
                            if (!replay || replaySeq >= (run.seq ?? 0)) {
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
                      <span>
                        {replay
                          ? `EVENT ${replaySeq}`
                          : hostedDemo
                            ? "FINAL EVENT"
                            : "LIVE EDGE"}
                      </span>
                      <input
                        type="range"
                        min="0"
                        max={run.seq ?? 0}
                        value={replay ? replaySeq : (run.seq ?? 0)}
                        disabled={!run.seq}
                        onChange={(e) => onReplay(Number(e.target.value), true)}
                        aria-label="Timeline replay scrubber"
                      />
                      <span>#{run.seq ?? 0}</span>
                    </div>
                  </section>
                  {shownRun && state && departments.length > 0 && (
                    <Analytics
                      key={run.id}
                      run={shownRun}
                      events={visibleEvents}
                      department={state.departments[arm] ?? departments[0]}
                      onArm={(id) => {
                        setArm(id);
                        setSelectedAgent(null);
                      }}
                      onReplay={inspectEvent}
                      onAgent={(a) => {
                        setSelectedAgent(a);
                        notebook("Memory");
                      }}
                    />
                  )}
                  <section id="notebook">
                    {state && shownRun && (
                      <Inspector
                        key={run.id + ":" + notebookKey}
                        initialArm={filterArm}
                        run={shownRun}
                        events={visibleEvents}
                        tab={tab}
                        setTab={setTab}
                        state={state}
                        selectedAgent={selectedAgent}
                        onAgent={setSelectedAgent}
                        replaySeq={replay ? replay.seq : (run.seq ?? 0)}
                        onReplay={onReplay}
                        onLive={liveReturn}
                        replaying={!!replay}
                      />
                    )}
                  </section>
                </>
              )}
              {view === "compare" && (
                <Compare key={run.id} run={run} runs={runs} />
              )}
              {view === "studies" && (
                <Studies
                  openRun={async (id) => {
                    await refreshList();
                    await selectRun(id);
                    navigate("lab");
                  }}
                />
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
              The purchasing work sample scores decisions against four private
              criteria. The task board checks submitted milestones. Live mode
              records model responses. Mock mode runs a deterministic policy.
              The office animates recorded events. Passive conversation (D) is a
              proposed condition for future studies.
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
                navigate("compare");
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
