import ChatTranscript from "./ChatTranscript";
import { useState } from "react";
import { hostedDemo } from "./api";
import type { Agent, Arm, LabEvent, Run, State } from "./types";
import { ARMS, COLORS, ROLES, money, nice, num } from "./types";
import Creature from "./Creature";
import Icon from "./Icon";
import TenderEvidence from "./TenderEvidence";

export const TABS = [
  "Activity",
  "Conversations",
  "Goals",
  "Metrics",
  "Memory",
  "Replay",
] as const;
export type InspectorTab = (typeof TABS)[number];

const eventText = (e: LabEvent) => {
  const action = e.payload_json.action as
    | { type?: string; task_id?: string }
    | undefined;
  return String(
    e.payload_json.text ??
      e.payload_json.message ??
      e.payload_json.reason ??
      e.payload_json.summary ??
      (action?.type
        ? `${nice(action.type)}${action.task_id ? ` · ${nice(action.task_id)}` : ""}`
        : nice(e.event_type)),
  );
};
const eventColor = (e: LabEvent) =>
  e.severity === "error"
    ? "#df9a89"
    : e.channel === "small_talk"
      ? "#e9b887"
      : e.event_type.includes("completed") || e.event_type.includes("passed")
        ? "#a9bcad"
        : "#979da5";

export function MetricsView({ run }: { run: Run }) {
  const depts = run.state?.departments ?? {};
  const metrics = run.metrics?.departments ?? {};
  const arms = Object.keys(depts) as Arm[];
  const purchasing = run.config.environment === "supplier_selection_v1";
  const rows: {
    label: string;
    key: string;
    format?: (n: unknown) => string;
    help?: string;
  }[] = [
    ...(purchasing
      ? [
          {
            label: "Decision yield",
            key: "decision_yield",
            format: (v: unknown) =>
              typeof v === "number" ? (100 * v).toFixed(1) + "%" : "—",
          },
          { label: "Points earned", key: "earned_points" },
          { label: "Points attainable", key: "attainable_points" },
          { label: "Optimal awards", key: "optimal_decisions" },
          { label: "Private scores disclosed", key: "disclosed_score_cells" },
          {
            label: "External scores available at award",
            key: "external_scores_at_award",
          },
        ]
      : []),
    {
      label: purchasing ? "Scored tenders awarded" : "Milestones passed",
      key: "completed",
    },
    {
      label: "Overall completion",
      key: "completion",
      format: (n) => (typeof n === "number" ? `${(n * 100).toFixed(0)}%` : "—"),
    },
    { label: "Model calls", key: "model_calls" },
    { label: "Work turns", key: "work_turns" },
    { label: "Input tokens", key: "input_tokens" },
    { label: "Output tokens", key: "output_tokens" },
    {
      label: "Estimated cost",
      key: "estimated_cost_usd",
      format: money,
      help: "Calculated from recorded token usage and configured model rates; not an invoice.",
    },
    {
      label: "Provider-reported cost",
      key: "actual_cost_usd",
      format: money,
      help: "Only available if the provider returns an actual charge.",
    },
    { label: "Invalid actions", key: "invalid_actions" },
    { label: "Dependency blocks", key: "blocked_actions" },
    { label: "Useful help given", key: "help_given" },
    { label: "Useful help received", key: "help_received" },
    { label: "Accurate handoffs", key: "handoffs" },
    { label: "Repairs", key: "repairs" },
    {
      label: "Duplicate claims prevented",
      key: "duplicate_claims_prevented",
      help: "Duplicate claims rejected by the engine; not a cooperation measure.",
    },
    { label: "All messages", key: "messages" },
    { label: "Small talk messages", key: "small_talk_messages" },
    { label: "Private journal entries", key: "journal_entries" },
    { label: "Reasoning tokens", key: "thought_tokens" },
    { label: "Cached tokens", key: "cached_tokens" },
    { label: "Total tokens", key: "total_tokens" },
    { label: "Retry attempts", key: "retry_attempts" },
    { label: "Failed attempts", key: "failed_attempts" },
    { label: "Simulated minutes", key: "simulated_minutes" },
    {
      label: "Wall-clock runtime",
      key: "wall_clock_ms",
      format: (n) =>
        typeof n === "number" ? `${(n / 1000).toFixed(1)} s` : "—",
    },
    {
      label: "Provider execution time",
      key: "provider_elapsed_ms",
      format: (n) =>
        typeof n === "number" ? `${(n / 1000).toFixed(1)} s` : "—",
    },
    { label: "Uncertain attempts", key: "uncertain_attempts" },
    { label: "Uncertain reserved tokens", key: "reserved_uncertain_tokens" },
    {
      label: "Uncertain reserved cost",
      key: "reserved_uncertain_cost_usd",
      format: money,
    },
  ];
  return (
    <div className="metrics-view">
      <div className="panel-intro">
        <span className="eyebrow">MEASURE WHAT HAPPENED</span>
        <h3>Outcomes before impressions.</h3>
        <p>
          Every count is derived from recorded actions. Cooperation indicators
          are behavioral proxies, never feelings.
        </p>
      </div>
      <div className="table-scroll">
        <table className="metric-table">
          <thead>
            <tr>
              <th>Recorded parameter</th>
              {arms.map((a) => (
                <th key={a}>Dept. {a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (row) =>
                  !purchasing ||
                  ![
                    "blocked_actions",
                    "help_given",
                    "help_received",
                    "handoffs",
                    "repairs",
                    "duplicate_claims_prevented",
                  ].includes(row.key),
              )
              .map((row) => (
                <tr
                  key={row.key}
                  className={row.key.includes("cost") ? "cost-row" : ""}
                >
                  <td title={row.help}>
                    {row.label}
                    {row.help && <Icon name="info" size={12} />}
                  </td>
                  {arms.map((a) => (
                    <td key={a}>
                      {(row.format ?? num)(metrics[a]?.[row.key])}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="inline-note">
        <Icon name="info" size={15} />
        <span>
          {run.config.provider === "mock"
            ? "Synthetic demonstration · "
            : "Live model run · "}
          n = 1 paired team run. Demo traces cannot establish a causal effect.
        </span>
      </div>
    </div>
  );
}

export default function Inspector({
  run,
  events,
  tab,
  setTab,
  state,
  selectedAgent,
  onAgent,
  replaySeq,
  onReplay,
  onLive,
  replaying,
  initialArm,
}: {
  initialArm: Arm;
  run: Run;
  events: LabEvent[];
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  state: State;
  selectedAgent: Agent | null;
  onAgent: (agent: Agent | null) => void;
  replaySeq: number;
  onReplay: (n: number) => void;
  onLive: () => void;
  replaying: boolean;
}) {
  const [department, setDepartment] = useState<string>(initialArm);
  const [limit, setLimit] = useState(100);
  const [day, setDay] = useState("all");
  const [agent, setAgent] = useState("all");
  const [channel, setChannel] = useState("all");
  const [task, setTask] = useState("all");
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [query, setQuery] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [goalArm, setGoalArm] = useState<Arm>(initialArm);
  const [memoryArm, setMemoryArm] = useState<Arm>(initialArm);
  const [conversationChannel, setConversationChannel] = useState("all");
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const departments = Object.values(state.departments);
  const allAgents = departments.flatMap((d) => d?.agents ?? []);
  const filtered = events.filter(
    (e) =>
      (department === "all" || e.department_id === department) &&
      (day === "all" || e.virtual_day === Number(day)) &&
      (agent === "all" || e.agent_id === agent) &&
      (channel === "all" || e.channel === channel) &&
      (task === "all" || e.task_id === task) &&
      (type === "all" || e.event_type === type) &&
      (severity === "all" || e.severity === severity) &&
      (!query || JSON.stringify(e).toLowerCase().includes(query.toLowerCase())),
  );
  const activity =
    type === "all" && !query
      ? filtered.filter(
          (e) =>
            ![
              "cursor_advanced",
              "provider_attempt_started",
              "agent_moving",
            ].includes(e.event_type),
        )
      : filtered;
  const messages = filtered
    .filter(
      (e) =>
        typeof e.payload_json.text === "string" &&
        (e.event_type === "message_sent" ||
          e.event_type === "journal_written" ||
          e.event_type === "chat_smalltalk"),
    )
    .filter(
      (e) => conversationChannel === "all" || e.channel === conversationChannel,
    );
  const tasks = state.departments[goalArm]?.tasks ?? [];
  const memoryAgents = selectedAgent
    ? [allAgents.find((a) => a.id === selectedAgent.id) ?? selectedAgent]
    : (state.departments[memoryArm]?.agents ?? []);
  return (
    <aside className="inspector panel">
      <div className="inspector-title">
        <span className="eyebrow">Research notebook</span>
        <span className="live-count">
          <span className={`status-dot ${replaying ? "sleep" : ""}`} />
          {replaying ? "Replay" : `${events.length} events`}
        </span>
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Research notebook"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {(tab === "Activity" || tab === "Conversations") && (
        <div className="log-toolbar">
          <label className="search-field">
            <Icon name="search" size={15} />
            <input
              aria-label="Search recorded events"
              placeholder="Search messages and events…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="filter-row">
            <select
              aria-label="Filter department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="all">All departments</option>
              {departments.map(
                (d) =>
                  d && (
                    <option key={d.id} value={d.id}>
                      Department {d.id}
                    </option>
                  ),
              )}
            </select>
            <select
              aria-label="Filter day"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              <option value="all">All days</option>
              {Array.from({ length: run.config.days }, (_, i) => (
                <option key={i} value={i + 1}>
                  Day {i + 1}
                </option>
              ))}
            </select>
            <button
              className={`filter-button ${moreFilters ? "active" : ""}`}
              title="Filter by agent, channel, task, type and severity"
              aria-expanded={moreFilters}
              onClick={() => setMoreFilters(!moreFilters)}
            >
              <Icon name="settings" size={15} />
            </button>
          </div>
          {moreFilters && (
            <div className="extended-filters">
              <select
                aria-label="Filter agent"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="all">All agents</option>
                {allAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} · {a.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="all">All channels</option>
                {["work", "small_talk", "notes", "system"].map((c) => (
                  <option key={c} value={c}>
                    {nice(c)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter task"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              >
                <option value="all">All milestones</option>
                {(departments[0]?.tasks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter event type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="all">All event types</option>
                {[...new Set(events.map((e) => e.event_type))]
                  .sort()
                  .map((t) => (
                    <option key={t} value={t}>
                      {nice(t)}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Filter severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="all">All severities</option>
                {["info", "warning", "error"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button
                className="text-button"
                onClick={() => {
                  setDepartment("all");
                  setDay("all");
                  setAgent("all");
                  setChannel("all");
                  setTask("all");
                  setType("all");
                  setSeverity("all");
                  setQuery("");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
      <div className="inspector-body">
        {tab === "Activity" && (
          <>
            <div className="section-label">
              {activity.length} MATCHING EVENTS <span>Latest first</span>
            </div>
            <div className="event-list">
              {activity
                .slice()
                .reverse()
                .slice(0, limit)
                .map((e) => (
                  <button
                    className="event-row"
                    key={e.event_id}
                    onClick={() => {
                      setTab("Replay");
                      onReplay(e.seq);
                    }}
                    title={`Inspect event ${e.seq} in replay · ${e.ts_utc} UTC`}
                  >
                    <div className="event-line">
                      <span
                        style={{ background: eventColor(e) }}
                        className="event-dot"
                      />
                    </div>
                    <div>
                      <div className="event-meta">
                        <strong>
                          {e.agent_id
                            ? (allAgents.find((a) => a.id === e.agent_id)
                                ?.name ?? e.agent_id)
                            : e.department_id
                              ? `Department ${e.department_id}`
                              : "Experiment"}
                        </strong>
                        <time>
                          DAY {e.virtual_day} <span>#{e.seq}</span>
                        </time>
                      </div>
                      <p>{eventText(e)}</p>
                      <span className="event-kind">
                        {nice(e.event_type)}
                        {e.department_id && ` · Dept. ${e.department_id}`}
                        {e.channel && ` · ${nice(e.channel)}`}
                      </span>
                    </div>
                    <Icon name="chevron" size={12} />
                  </button>
                ))}
            </div>
            {activity.length > limit && (
              <button
                className="text-button"
                onClick={() => setLimit(limit + 100)}
              >
                Load more events
              </button>
            )}
            {!activity.length && (
              <Empty
                icon="activity"
                title="A quiet moment before discovery"
                text={
                  events.length
                    ? "No events match these filters."
                    : "Start the experiment to watch every decision, message and handoff arrive here."
                }
              />
            )}
          </>
        )}
        {tab === "Conversations" && (
          <>
            <div className="segment small">
              {[
                ["all", "All messages"],
                ["work", "Work"],
                ["small_talk", "Small talk"],
                ["notes", "Journal"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={conversationChannel === v ? "active" : ""}
                  onClick={() => setConversationChannel(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            {messages.length > 0 && (
              <ChatTranscript
                messages={messages}
                agents={allAgents}
                department={department}
                channel={conversationChannel}
                synthetic={run.config.provider === "mock"}
                onReplay={(seq) => {
                  setTab("Replay");
                  onReplay(seq);
                }}
              />
            )}
            {!messages.length && (
              <Empty
                icon="chat"
                title="The conversation starts here"
                text="Work, small talk and private journals stay in separate channels. Only recorded messages appear."
              />
            )}
            <div className="inline-note">
              <Icon name="info" size={14} />
              <span>
                Small talk has no task-state access. Project content is rejected
                by the engine.
              </span>
            </div>
          </>
        )}
        {tab === "Goals" && (
          <>
            <div className="segment">
              {departments.map(
                (d) =>
                  d && (
                    <button
                      key={d.id}
                      className={goalArm === d.id ? "active" : ""}
                      onClick={() => setGoalArm(d.id)}
                    >
                      Dept. {d.id}
                    </button>
                  ),
              )}
            </div>
            <div className="panel-intro compact">
              <h3>
                {run.config.environment === "supplier_selection_v1"
                  ? "The purchasing brief"
                  : "One project. Carried forward."}
              </h3>
              <p>
                {run.config.environment === "supplier_selection_v1"
                  ? "One practice decision precedes the first break. Six scored tenders follow. Each role has a private criterion and the integrator awards the contract."
                  : "A deterministic task-board project with machine-checked milestone requirements."}
              </p>
            </div>
            {run.config.environment === "supplier_selection_v1" && (
              <TenderEvidence runId={run.id} tasks={tasks} />
            )}
            <div className="goal-list">
              {tasks.map((t, i) => (
                <article
                  key={t.id}
                  className={`goal ${t.status === "integrated" ? "complete" : ""}`}
                >
                  <button
                    onClick={() =>
                      setExpandedTask(expandedTask === t.id ? null : t.id)
                    }
                    aria-expanded={expandedTask === t.id}
                  >
                    <span className="goal-number">
                      {t.status === "integrated" ? (
                        <Icon name="check" size={14} />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <div>
                      <strong>{t.title}</strong>
                      <span>
                        {nice(t.status)}
                        {t.owner && ` · ${t.owner}`}
                      </span>
                    </div>
                    <Icon name="chevron" size={14} />
                  </button>
                  {expandedTask === t.id && (
                    <div className="goal-details">
                      <p>
                        <strong>Acceptance criterion</strong>
                        {t.acceptance}
                      </p>
                      <p>
                        <strong>Dependencies</strong>
                        {t.dependencies.length
                          ? t.dependencies.join(", ")
                          : "No dependencies"}
                      </p>
                      {!!t.artifact && (
                        <details>
                          <summary>
                            Recorded artifact · v{t.version ?? 1}
                          </summary>
                          <pre>{JSON.stringify(t.artifact, null, 2)}</pre>
                        </details>
                      )}
                      {!!t.review && (
                        <details>
                          <summary>Review result</summary>
                          <pre>{JSON.stringify(t.review, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "Metrics" && <MetricsView run={{ ...run, state }} />}
        {tab === "Memory" && (
          <>
            {selectedAgent ? (
              <button className="text-button" onClick={() => onAgent(null)}>
                ← All agent memories
              </button>
            ) : (
              <div className="segment">
                {departments.map(
                  (d) =>
                    d && (
                      <button
                        key={d.id}
                        className={memoryArm === d.id ? "active" : ""}
                        onClick={() => setMemoryArm(d.id)}
                      >
                        Dept. {d.id}
                      </button>
                    ),
                )}
              </div>
            )}
            <div className="panel-intro compact">
              <h3>
                {selectedAgent
                  ? `${selectedAgent.name}'s notebook`
                  : "A little context, kept overnight."}
              </h3>
              <p>
                Persisted episodic notes. Sleep saves memory; it does not update
                model weights.
              </p>
            </div>
            {memoryAgents.map((a) => (
              <article className="memory-agent" key={a.id}>
                <div className="memory-heading">
                  <Creature
                    role={Math.max(0, ROLES.indexOf(a.role))}
                    size={34}
                  />
                  <div>
                    <strong>{a.name}</strong>
                    <span>
                      {nice(a.role)} · {nice(a.activity)}
                    </span>
                  </div>
                  <span className="count-pill">{a.memory.length} notes</span>
                </div>
                {a.memory.length ? (
                  <div className="memory-notes">
                    {a.memory.slice(-20).map((m, i) => (
                      <div key={i}>
                        <span>
                          DAY {m.day} · {nice(m.channel)}
                        </span>
                        <p>
                          {m.text ??
                            (m.action
                              ? nice(m.action.type) +
                                (m.action.task_id
                                  ? " · " + m.action.task_id
                                  : "")
                              : "Event recorded")}
                          {m.reason ? " — " + m.reason : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-memory">
                    No memories yet. Notes will be persisted as days unfold.
                  </p>
                )}
              </article>
            ))}
          </>
        )}
        {tab === "Replay" && (
          <>
            <div className="panel-intro">
              <span className="eyebrow">READ-ONLY TIME TRAVEL</span>
              <h3>Every step has a paper trail.</h3>
              <p>
                Reconstruct the lab from its recorded events. Scrubbing never
                changes the live experiment.
              </p>
            </div>
            <div className="replay-controls">
              <div>
                <strong>Event #{replaySeq}</strong>
                <span>of {run.seq ?? events.at(-1)?.seq ?? 0}</span>
              </div>
              <input
                type="range"
                aria-label="Replay event"
                min="0"
                max={run.seq ?? events.at(-1)?.seq ?? 0}
                value={replaySeq}
                onChange={(e) => onReplay(Number(e.target.value))}
              />
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={replaySeq <= 0}
                  onClick={() => onReplay(Math.max(0, replaySeq - 1))}
                >
                  ← Previous
                </button>
                <button
                  className="button secondary"
                  disabled={replaySeq >= (run.seq ?? 0)}
                  onClick={() => onReplay(replaySeq + 1)}
                >
                  Next →
                </button>
                <button className="button" onClick={onLive}>
                  {hostedDemo ? "Return to results" : "Return to live"}
                </button>
              </div>
            </div>
            {events.find((e) => e.seq === replaySeq) && (
              <article className="replay-event">
                <span className="eyebrow">SELECTED EVENT</span>
                <h4>
                  {nice(events.find((e) => e.seq === replaySeq)!.event_type)}
                </h4>
                <pre>
                  {JSON.stringify(
                    events.find((e) => e.seq === replaySeq),
                    null,
                    2,
                  )}
                </pre>
              </article>
            )}
            <div className="inline-note">
              <Icon name="link" size={15} />
              <span>
                Config: {run.config_hash?.slice(0, 16)}
                <br />
                Initial state: {run.initial_state_hash?.slice(0, 16)}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="inspector-footer">
        <Icon name="flask" size={13} />
        <span>Observable behavior. No claims of artificial feelings.</span>
      </div>
    </aside>
  );
}

export function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function CooperationGraph({
  edges,
  arm,
}: {
  edges: { source: string; target: string; count: number }[];
  arm: Arm;
}) {
  const points = [
    [65, 45],
    [215, 45],
    [65, 130],
    [215, 130],
  ];
  return (
    <div className="cooperation-graph">
      <svg
        viewBox="0 0 280 174"
        role="img"
        aria-label={`${edges.length} recorded cooperation links for department ${arm}`}
      >
        {edges.map((e, i) => {
          const from = String(e.source).split("-").at(-1);
          const to = String(e.target).split("-").at(-1);
          const roles = ["coordinator", "builder", "verifier", "integrator"];
          const a = roles.indexOf(from ?? "");
          const b = roles.indexOf(to ?? "");
          if (a < 0 || b < 0) return null;
          return (
            <path
              key={i}
              d={`M${points[a].join(",")}L${points[b].join(",")}`}
              stroke={ARMS[arm].color}
              opacity=".5"
              strokeWidth={Math.min(5, 1 + e.count)}
            >
              <title>
                {e.source} → {e.target}: {e.count} validated actions
              </title>
            </path>
          );
        })}
        {points.map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <circle
              r="23"
              fill="#272e2c"
              stroke={COLORS[i]}
              strokeOpacity=".5"
            />
            <g transform="translate(-19 -20)">
              <Creature role={i} size={38} />
            </g>
            <text y="37" textAnchor="middle" fontSize="10" fill="#a1a59f">
              {["Coordinator", "Builder", "Verifier", "Integrator"][i]}
            </text>
          </g>
        ))}
      </svg>
      <span>
        {edges.length
          ? `${edges.length} recorded cooperation links`
          : "No validated cooperation edges recorded yet"}
      </span>
    </div>
  );
}
