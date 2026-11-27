import DepartmentTransition from "./DepartmentTransition";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import type { Agent, Arm, Department, LabEvent, Run, State } from "../types";
import { ARMS, minute, nice, money, num } from "../types";
import Creature, { getPoses, poseLabels } from "../Creature";
import Icon from "../Icon";
import type { InspectorTab } from "../Inspector";
import Room2D from "./Room2D";
import DepartmentBoard from "./DepartmentBoard";
import { names, descriptions, sceneModel, roomAccents } from "./roomDesign";
import { useReducedMotion, useVisibility, useWalkers } from "./motion";
const Room3D = lazy(() => import("./Room3D"));
export const meaningful = (e: LabEvent) =>
  [
    "message_sent",
    "action_accepted",
    "action_rejected",
    "phase_started",
    "day_completed",
    "sleep_started",
    "provider_attempt_failed",
  ].includes(e.event_type) || e.severity === "error";
export function eventSummary(e: LabEvent) {
  const p = e.payload_json,
    a = p.action as { type?: string } | undefined;
  if (typeof p.text === "string") return p.text;
  if (e.event_type === "action_accepted" || e.event_type === "action_rejected")
    return (
      nice(a?.type ?? e.event_type) +
      (e.task_id ? " · " + e.task_id : "") +
      (e.event_type === "action_rejected" ? " · rejected" : "")
    );
  return nice(p.reason ?? p.phase ?? p.status ?? e.event_type);
}
type Props = {
  state: State;
  run: Run;
  seq: number;
  events: LabEvent[];
  arm: Arm;
  onArm: (id: Arm) => void;
  selected: Agent | null;
  onPick: (a: Agent | null) => void;
  open: (tab: InspectorTab) => void;
  onReplay: (seq: number) => void;
};
function Camera({
  department: d,
  events,
  state,
  selected,
  onPick,
  mode,
  setMode,
  cameraToolbar,
}: {
  cameraToolbar: HTMLDivElement | null;
  department: Department;
  mode: string;
  setMode: (m: string) => void;
} & Pick<Props, "state" | "events" | "selected" | "onPick">) {
  const room = useMemo(() => sceneModel(d.id), [d.id]),
    { ref, active } = useVisibility<HTMLDivElement>(),
    reduced = useReducedMotion();
  const poses = useMemo(
    () =>
      getPoses(
        d.agents,
        events.filter((e) => !e.department_id || e.department_id === d.id),
        state.phase,
      ),
    [events, d, state.phase],
  );
  const { positions, move } = useWalkers(
    d.agents,
    room,
    active,
    state.phase,
    reduced,
    events.at(-1)?.seq ?? 0,
  );
  const [ready, setReady] = useState(mode === "2D");
  const loaded = useCallback(() => setReady(true), []);
  useEffect(() => {
    setReady(mode === "2D");
  }, [mode]);
  const props = {
    room,
    agents: d.agents,
    poses,
    positions,
    selected: selected?.id ?? "",
    onPick,
    onMove: move,
    active,
    reduced,
    phase: state.phase,
    accent: roomAccents[d.id],
  };
  return (
    <div className={"camera-frame" + (!active ? " offscreen" : "")} ref={ref}>
      {mode === "2D" ? (
        <Room2D {...props} />
      ) : (
        <Suspense
          fallback={
            <span className="scene-loading">Preparing 3D geometry…</span>
          }
        >
          <Room3D
            {...props}
            toolbar={cameraToolbar}
            onReady={loaded}
            onFallback={() => setMode("2D")}
          />
        </Suspense>
      )}
      {!ready && mode === "3D" && (
        <span className="scene-loading" role="status">
          Preparing 3D geometry…
        </span>
      )}
      {mode === "2D" && (
        <div className="camera-time">
          <Icon name={state.phase === "sleep" ? "moon" : "clock"} size={12} />
          Day {state.virtual_day} · {minute(state.virtual_minute)}
        </div>
      )}
    </div>
  );
}
export default function Deck({
  state,
  run,
  seq,
  events,
  arm,
  onArm,
  selected,
  onPick,
  open,
  onReplay,
}: Props) {
  const depts = Object.values(state.departments).filter(
    (v): v is Department => !!v,
  );
  const d = state.departments[arm] ?? depts[0],
    [mode, setMode] = useState(() =>
      new URLSearchParams(location.search).get("scene") === "3d" ? "3D" : "2D",
    ),
    [all, setAll] = useState(false),
    [large, setLarge] = useState(false),
    [detail, setDetail] = useState("Crew");
  const [pending, setPending] = useState<Arm | null>(null);
  const reduced = useReducedMotion();
  const compareButton = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [cameraToolbar, setCameraToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  useEffect(() => {
    if (!large) return;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLarge(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [large]);
  if (!d) return <p>No departments are configured for this run.</p>;
  const group = events.filter((e) => e.department_id === d.id),
    latest = group
      .filter((e) => e.event_type === "message_sent" && e.channel !== "notes")
      .at(-1),
    m = run.metrics?.departments[d.id];
  const who = d.agents.find((a) => a.id === selected?.id),
    poses = getPoses(
      d.agents,
      events.filter((e) => !e.department_id || e.department_id === d.id),
      state.phase,
    );
  const arrive = (id: Arm) => {
    onArm(id);
    onPick(null);
    if (all) compareButton.current?.focus();
    setAll(false);
  };
  const change = (id: Arm) => {
    if (pending) return;
    if (reduced || id === d.id) arrive(id);
    else setPending(id);
  };
  const arrow = (n: number) =>
    change(depts[(depts.indexOf(d) + n + depts.length) % depts.length].id);
  return (
    <div
      className={"observatory" + (all ? " is-comparing" : "")}
      style={{ "--arm": ARMS[d.id].color } as CSSProperties}
    >
      <section
        className={"viewport-card" + (large ? " expanded" : "")}
        aria-label="Department viewport"
      >
        <div className="deck-head">
          {all ? (
            <div className="board-title">
              <span className="overline">Matched departments</span>
              <h2>Side by side</h2>
            </div>
          ) : (
            <div className="deck-ident">
              <div className="dept-insignia">{d.id}</div>
              <div>
                <div className="overline">
                  <span className="full-condition">DEPARTMENT </span>
                  {d.id} <i /> {ARMS[d.id].title}
                </div>
                <h2 aria-label={names[d.id]}>
                  {[...names[d.id]].map((c, i) => (
                    <span
                      aria-hidden="true"
                      style={{ animationDelay: i * 19 + "ms" }}
                      key={i}
                    >
                      {c === " " ? "\u00a0" : c}
                    </span>
                  ))}
                </h2>
              </div>
            </div>
          )}
          <div className="deck-switches">
            <button
              className="compare-switch"
              title={all ? "Return to the featured room" : "Compare all departments"}
              ref={compareButton}
              disabled={!!pending}
              aria-pressed={all}
              onClick={() => setAll(!all)}
            >
              <Icon name={all ? "station" : "grid"} size={15} />
              {all ? "Featured room" : "Compare all"}
            </button>
            {!all && (
              <div className="dept-picker">
                <button
                  disabled={!!pending}
                  aria-label="Previous department"
                  onClick={() => arrow(-1)}
                >
                  ‹
                </button>
                <select
                  aria-label="Featured department"
                  disabled={!!pending}
                  value={pending ?? d.id}
                  onChange={(e) => change(e.target.value as Arm)}
                >
                  {depts.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!!pending}
                  aria-label="Next department"
                  onClick={() => arrow(1)}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </div>
        {!all && <p className="deck-intro">{descriptions[d.id]}</p>}
        <div
          className={
            "viewport-body" + (!all && mode === "3D" ? " volume-view" : "")
          }
        >
          {pending && (
            <DepartmentTransition
              key={pending}
              name={names[pending]}
              onArrive={() => arrive(pending)}
              onFinish={() => setPending(null)}
            />
          )}
          {all ? (
            <DepartmentBoard
              departments={depts}
              run={run}
              state={state}
              events={events}
              seq={seq}
              onExpand={change}
              onReplay={onReplay}
            />
          ) : (
            <Camera
              key={run.id + d.id}
              department={d}
              events={events}
              state={state}
              selected={who ?? null}
              onPick={(a) => {
                onPick(a);
                setDetail("Crew");
              }}
              mode={mode}
              setMode={setMode}
              cameraToolbar={cameraToolbar}
            />
          )}
        </div>
        {!all && (
          <div className="viewport-tools">
            <span className="phase-chip">
              <i />
              {nice(state.phase)}
            </span>
            {!all && (
              <span className="walk-hint">
                {mode === "2D"
                  ? "Drag a crew member for a short walk"
                  : "Drag to orbit · scroll to zoom"}
              </span>
            )}
            <div className="viewport-actions">
              <div className="camera-tools" ref={setCameraToolbar} />
              <div className="dimension">
                {["2D", "3D"].map((v) => (
                  <button
                    key={v}
                    disabled={!!pending}
                    aria-label={v + " view"}
                    aria-pressed={!all && v === mode}
                    onClick={() => {
                      setAll(false);
                      setMode(v);
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                ref={closeBtn}
                className="expand-btn"
                title={large ? "Close expanded scene" : "Expand scene"}
                aria-label={large ? "Close expanded scene" : "Expand scene"}
                onClick={() => setLarge(!large)}
              >
                <Icon name={large ? "close" : "expand"} size={15} />
              </button>
            </div>
          </div>
        )}
        {all && large && (
          <button className="board-exit" onClick={() => setLarge(false)}>
            Close expanded scene
          </button>
        )}
      </section>
      <div className="inspector-slot" inert={all} aria-hidden={all}>
        <aside className="crew-console">
          <div className="console-heading">
            <span className="overline">
              <i /> <span className="full-condition">DEPARTMENT </span>
              {d.id}
            </span>
            <Icon name="settings" size={17} />
          </div>
          <h2>Research inspector</h2>
          <div className="console-tabs">
            {["Crew", "Activity", "Evidence", "Metrics"].map((v) => (
              <button
                key={v}
                aria-pressed={detail === v}
                onClick={() => setDetail(v)}
              >
                {v}
              </button>
            ))}
          </div>
          {detail === "Crew" ? (
            <>
              <div className="roster">
                {d.agents.map((a, i) => (
                  <button
                    key={a.id}
                    aria-pressed={who?.id === a.id}
                    onClick={() => onPick(who?.id === a.id ? null : a)}
                    style={
                      {
                        "--fur": "var(--role-" + (i + 1) + ")",
                      } as CSSProperties
                    }
                  >
                    <span className="portrait">
                      <Creature role={i} size={46} pose={poses[a.id].pose} />
                    </span>
                    <span className="crew-name">
                      <strong>{a.name}</strong>
                      <small>{nice(a.role)}</small>
                    </span>
                    <span className="crew-status">
                      <i />
                      {poseLabels[poses[a.id].pose]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="current-brief">
                <span className="overline">Next unfinished task</span>
                <strong>
                  {d.tasks.find((t) => t.status !== "integrated")?.title ??
                    "All assignments complete"}
                </strong>
                <span>
                  Recorded location ·{" "}
                  {who
                    ? nice(who.location)
                    : nice(d.agents[0]?.location ?? "Unknown")}
                </span>
              </div>
              {who ? (
                <div className="transmission">
                  <div className="overline">{who.name} · selected</div>
                  <p>
                    {poseLabels[poses[who.id].pose]} · {nice(who.location)}
                    {who.memory.at(-1)?.action?.task_id &&
                      " · " + who.memory.at(-1)?.action?.task_id}
                  </p>
                  <button onClick={() => open("Memory")}>
                    Inspect memory <Icon name="arrow" size={13} />
                  </button>
                </div>
              ) : (
                <div className="transmission">
                  <div className="overline">
                    <Icon name="chat" size={13} /> Last transmission
                  </div>
                  {latest ? (
                    <>
                      <p>“{String(latest.payload_json.text)}”</p>
                      <button onClick={() => open("Conversations")}>
                        Open transcript <Icon name="arrow" size={13} />
                      </button>
                    </>
                  ) : (
                    <p>Messages will appear after an agent sends one.</p>
                  )}
                </div>
              )}
            </>
          ) : detail === "Activity" ? (
            <div className="brief-feed">
              {group
                .filter(meaningful)
                .slice(-5)
                .reverse()
                .map((e) => (
                  <button key={e.seq} onClick={() => onReplay(e.seq)}>
                    <small>
                      #{e.seq} · {nice(e.event_type)}
                    </small>
                    <span>{eventSummary(e)}</span>
                  </button>
                ))}
              <button className="inspect-link" onClick={() => open("Activity")}>
                Open event log ↗
              </button>
            </div>
          ) : detail === "Evidence" ? (
            <div className="brief-data">
              <strong>{num(m?.disclosed_score_cells)}</strong>
              <p>Private supplier scores shared in scored cases.</p>
              <strong>{num(m?.external_scores_at_award)}</strong>
              <p>
                External scores available at award. Use in reasoning is
                unmeasured.
              </p>
              <button onClick={() => open("Goals")}>
                Inspect task evidence ↗
              </button>
            </div>
          ) : (
            <div className="brief-data">
              {[
                [
                  "Decision yield",
                  typeof m?.decision_yield === "number"
                    ? (m.decision_yield * 100).toFixed(1) + "%"
                    : "—",
                ],
                [
                  run.config.provider === "mock"
                    ? "Synthetic calls"
                    : "Model calls",
                  num(m?.model_calls),
                ],
                ["Tokens", num(m?.total_tokens)],
                ["Estimated cost", money(m?.estimated_cost_usd)],
                ["Total execution", num(m?.provider_elapsed_ms) + " ms"],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
              <button onClick={() => open("Metrics")}>
                Inspect all metrics ↗
              </button>
            </div>
          )}
        </aside>
      </div>
      {all && !reduced && (
        <div aria-hidden="true" className="inspector-dust">
          {Array.from({ length: 22 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  top: 6 + ((i * 29) % 86) + "%",
                  left: ((i * 17) % 43) + "%",
                  "--drift": ((i * 19) % 46) - 23 + "px",
                  animationDelay: (i % 7) * 24 + "ms",
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
