import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Agent, Department, DepartmentMetrics, LabEvent } from "./types";
import { ARMS, COLORS, nice, num } from "./types";
import Icon from "./Icon";

import Creature, { getPoses, poseLabels } from "./Creature";
import MessagePaths from "./MessagePaths";
export { Creature };

function Desk({ x, y, index }: { x: number; y: number; index: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x="-42"
        y="-13"
        width="84"
        height="45"
        rx="5"
        fill="#151c1d"
        opacity=".5"
      />
      <path
        d="M-43-27H43V17H-43Z"
        fill="#746251"
        stroke="#9c8163"
        strokeWidth="1"
      />
      <path d="M-43 17H43V23H-43Z" fill="#4e4238" />
      <rect
        x="-22"
        y="-34"
        width="44"
        height="28"
        rx="3"
        fill="#171f21"
        stroke="#8f9994"
        strokeWidth="1.4"
      />
      <rect x="-18" y="-30" width="36" height="20" rx="1" fill="#2e4946" />
      <path
        d="M-13-25h19m-19 5h25m-25 5h14"
        stroke={COLORS[index]}
        strokeWidth="1.3"
        opacity=".7"
      />
      <path d="M0-6v5m-9 0H9" stroke="#c0b7a6" strokeWidth="2" />
      <rect
        x="-18"
        y="4"
        width="28"
        height="6"
        rx="2"
        fill="#b6aea0"
        opacity=".8"
      />
      <rect x="26" y="-4" width="8" height="11" rx="2" fill={COLORS[index]} />
      <path d="M34-1q6 0 2 5h-2" stroke={COLORS[index]} strokeWidth="2" />
      <rect
        x="-17"
        y="29"
        width="34"
        height="29"
        rx="9"
        fill="#414c47"
        stroke="#606c5c"
      />
      <path d="M-12 34h24" stroke="#7b8571" strokeWidth="2" />
    </g>
  );
}

function Plant({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="8" rx="14" ry="5" fill="#101818" opacity=".3" />
      <path d="M-11-6h22L8 11H-8Z" fill="#a87d5c" />
      <path
        d="M0-8v-22M0-9q-25-8-14-21Q-2-30 0-9M0-16q3-24 16-18Q23-20 0-16M0-21q-12-17-4-23Q7-43 0-21"
        stroke="#748f6d"
        fill="#687f5d"
        strokeWidth="2"
      />
    </g>
  );
}

const deskPositions = [
  [138, 127],
  [439, 127],
  [138, 265],
  [439, 265],
];
const tablePositions = [
  [247, 178],
  [329, 178],
  [329, 247],
  [247, 247],
];
const bedPositions = [
  [110, 365],
  [234, 365],
  [357, 365],
  [480, 365],
];

export default function Office({
  department,
  metrics,
  events,
  phase,
  onAgent,
  paths = false,
  procurement = false,
  onReplay,
}: {
  department: Department;
  metrics?: DepartmentMetrics;
  events: LabEvent[];
  phase?: string;
  onAgent: (agent: Agent) => void;
  paths?: boolean;
  procurement?: boolean;
  onReplay: (seq: number) => void;
}) {
  const { id, agents, tasks } = department;
  const priorLocations = useRef<Record<string, string>>({});
  const [moving, setMoving] = useState<string[]>([]);
  const positions = agents.map((a) => `${a.id}:${a.location}`).join("|");
  useEffect(() => {
    const changed = agents
      .filter(
        (a) =>
          priorLocations.current[a.id] &&
          priorLocations.current[a.id] !== a.location,
      )
      .map((a) => a.id);
    priorLocations.current = Object.fromEntries(
      agents.map((a) => [a.id, a.location]),
    );
    if (!changed.length) return;
    setMoving(changed);
    const timer = setTimeout(() => setMoving([]), 1000);
    return () => clearTimeout(timer);
  }, [positions]);
  const arm = ARMS[id];
  const poses = getPoses(agents, events, phase);
  const passed = tasks.filter((t) => t.status === "integrated").length;
  const latest = events
    .filter(
      (e) =>
        e.department_id === id &&
        e.event_type === "message_sent" &&
        e.channel !== "notes",
    )
    .at(-1);
  const spoken = latest?.payload_json.text;
  const ready = !phase || phase === "ready" || phase === "created";
  const progress = metrics?.completion
    ? metrics.completion <= 1
      ? metrics.completion * 100
      : metrics.completion
    : (passed / tasks.length) * 100 || 0;
  return (
    <section className={`office-card arm-${id}`}>
      <div className="office-heading">
        <div className="arm-tag">{id}</div>
        <div>
          <h2>Department {id}</h2>
          <span>{arm.title}</span>
        </div>
        <span className="condition-tag">
          {id === "C" ? (
            <Icon name="chat" size={12} />
          ) : id === "B" ? (
            <Icon name="memory" size={12} />
          ) : (
            <Icon name="board" size={12} />
          )}{" "}
          {id === "C"
            ? "Social condition"
            : id === "B"
              ? "Journal control"
              : "Baseline"}
        </span>
      </div>
      {paths ? (
        <MessagePaths
          department={department}
          events={events}
          onAgent={onAgent}
          onReplay={onReplay}
        />
      ) : (
        <div
          className={`office-scene ${phase === "sleep" ? "night-scene" : ""}`}
        >
          <svg
            viewBox="0 0 580 408"
            role="img"
            aria-label={`Department ${id}, ${arm.title}. ${agents.map((a) => `${a.name}, ${a.activity}`).join(". ")}`}
          >
            <defs>
              <pattern
                id={`floor-${id}`}
                width="42"
                height="42"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M42 0H0v42"
                  fill="none"
                  stroke="#373e39"
                  strokeWidth=".7"
                />
              </pattern>
              <linearGradient id={`room-${id}`} x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#323d35" />
                <stop offset="1" stopColor="#242e2a" />
              </linearGradient>
              <linearGradient id={`window-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop stopColor="#83978c" />
                <stop offset="1" stopColor="#485f56" />
              </linearGradient>
            </defs>
            <rect
              x="18"
              y="15"
              width="544"
              height="375"
              rx="9"
              fill="#101816"
            />
            <path d="M24 61H556V382H24Z" fill={`url(#room-${id})`} />
            <path d="M24 61H556V382H24Z" fill={`url(#floor-${id})`} />
            <path d="M24 22H556V63H24Z" fill="#4b5145" />
            <path d="M24 62v320h9V64m514 0v318h9V62" fill="#4b5145" />
            {[100, 376].map((x) => (
              <g key={x}>
                <rect
                  x={x}
                  y="25"
                  width="104"
                  height="29"
                  rx="2"
                  fill={`url(#window-${id})`}
                  stroke="#a39f85"
                  strokeWidth="2"
                />
                <path
                  d={`M${x + 52} 25v29m-52-15h104`}
                  stroke="#a39f85"
                  strokeWidth="2"
                />
                <path
                  d={`m${x + 4} 30 16-3m-16 10 28-7`}
                  stroke="#bbc2a8"
                  opacity=".3"
                />
              </g>
            ))}
            <rect x="264" y="30" width="54" height="19" rx="2" fill="#d8c9a4" />
            <text
              x="291"
              y="43"
              textAnchor="middle"
              fontSize="8"
              fontFamily="monospace"
              fill="#584c3d"
            >
              DEPT. {id}
            </text>
            <path
              d="M290 72V327M61 205h458"
              stroke="#87947b"
              strokeDasharray="2 8"
              opacity=".15"
            />
            {deskPositions.map(([x, y], i) => (
              <Desk key={i} x={x} y={y} index={i} />
            ))}
            {id === "C" ? (
              <g>
                <ellipse
                  cx="290"
                  cy="216"
                  rx="50"
                  ry="31"
                  fill="#1a2320"
                  opacity=".5"
                />
                <ellipse
                  cx="290"
                  cy="209"
                  rx="46"
                  ry="30"
                  fill="#6e5343"
                  stroke="#9e7d5a"
                  strokeWidth="2"
                />
                <ellipse cx="290" cy="203" rx="46" ry="27" fill="#a08560" />
                <path
                  d="M290 183v40m-29-20h58"
                  stroke="#c4a37a"
                  opacity=".22"
                />
                <circle cx="287" cy="199" r="5" fill="#d1c5a5" />
                <path d="M283 196q4-7 8 0" stroke="#79916d" strokeWidth="3" />
                <text
                  x="290"
                  y="253"
                  textAnchor="middle"
                  fontSize="9"
                  fill="#a8b49b"
                  letterSpacing="2"
                >
                  SMALL TALK TABLE
                </text>
              </g>
            ) : (
              <g>
                <rect
                  x="252"
                  y="185"
                  width="77"
                  height="53"
                  rx="5"
                  fill="#39473b"
                  stroke="#4b5b49"
                />
                <path
                  d="M261 193h59m-59 10h59m-59 10h59m-59 10h59"
                  stroke="#65775e"
                  opacity=".3"
                />
                <text
                  x="291"
                  y="210"
                  textAnchor="middle"
                  fontSize="9"
                  fill="#92a187"
                >
                  {id === "B" ? "REFLECTION" : "QUIET BREAK"}
                </text>
                <text
                  x="291"
                  y="253"
                  textAnchor="middle"
                  fontSize="9"
                  fill="#a8b49b"
                  letterSpacing="2"
                >
                  {id === "B" ? "PRIVATE JOURNALS" : "SPACE TO RECHARGE"}
                </text>
              </g>
            )}
            <path d="M34 329h512" stroke="#67705c" opacity=".45" />
            {bedPositions.map(([x, y], i) => (
              <g key={i} transform={`translate(${x} ${y})`}>
                <rect
                  x="-38"
                  y="-24"
                  width="77"
                  height="35"
                  rx="4"
                  fill="#695e4d"
                />
                <rect
                  x="-35"
                  y="-21"
                  width="71"
                  height="27"
                  rx="3"
                  fill="#6f7b69"
                />
                <rect
                  x="-32"
                  y="-19"
                  width="21"
                  height="23"
                  rx="3"
                  fill="#c2bea6"
                />
                <path d="M-6-21V6" stroke="#99a38a" strokeWidth="2" />
                <text
                  x="1"
                  y="23"
                  textAnchor="middle"
                  fontSize="8"
                  fill="#8b9681"
                >
                  {agents[i]?.name.split(" ")[0] ?? "Rest"}
                </text>
              </g>
            ))}
            <Plant x={57} y={101} scale={0.65} />
            <Plant x={526} y={302} scale={0.85} />
            <Plant x={53} y={300} scale={0.6} />
            <g transform="translate(520 98)">
              <rect
                x="-12"
                y="-25"
                width="24"
                height="35"
                rx="2"
                fill="#4e4b3e"
              />
              <rect
                x="-9"
                y="-21"
                width="18"
                height="11"
                rx="1"
                fill="#909783"
              />
              <path
                d="M-7-7h14m-10 4v8h6v-8"
                stroke="#a99e7d"
                strokeWidth="1.5"
              />
            </g>
            {agents.map((agent, i) => {
              const event = events
                .filter(
                  (e) =>
                    e.agent_id === agent.id && e.event_type === "agent_moving",
                )
                .at(-1);
              const loc = String(
                agent.location || event?.payload_json.destination || "desk",
              ).toLowerCase();
              const sleeping = /bed|home|sleep/.test(loc) || phase === "sleep";
              const talking =
                /table|break/.test(loc) || (id === "C" && phase === "break");
              const [x, y] = sleeping
                ? bedPositions[i % 4]
                : talking
                  ? tablePositions[i % 4]
                  : [deskPositions[i % 4][0], deskPositions[i % 4][1] + 40];
              const portrait = poses[agent.id];
              const speaking =
                talking &&
                portrait.pose === "talking" &&
                latest?.agent_id === agent.id;
              return (
                <g
                  key={agent.id}
                  className={`office-agent ${sleeping ? "sleeping" : ""} ${moving.includes(agent.id) ? "agent-walking" : ""} ${speaking ? "agent-speaking" : ""} ${agent.activity === "working" ? "agent-working" : ""}`}
                  style={
                    {
                      transform: `translate(${x}px, ${y}px)`,
                      "--agent-delay": `${-i * 1.37}s`,
                    } as CSSProperties
                  }
                  onClick={() => onAgent(agent)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Inspect ${agent.name}, ${agent.role}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onAgent(agent);
                    }
                  }}
                >
                  <title>
                    {agent.name} · {nice(agent.role)} ·{" "}
                    {poseLabels[portrait.pose]}
                    {portrait.evidence && ` · event #${portrait.evidence.seq}`}
                  </title>
                  <g transform="translate(-29 -39)">
                    <Creature role={i % 4} size={58} pose={portrait.pose} />
                  </g>
                  {["puzzled", "asking", "pleased", "checking"].includes(
                    portrait.pose,
                  ) && (
                    <g className="pose-callout" transform="translate(18 -40)">
                      <rect
                        x="-3"
                        y="-10"
                        width="20"
                        height="18"
                        rx="6"
                        fill="#f4ddac"
                      />
                      <text
                        x="7"
                        y="3"
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="bold"
                        fill="#483e31"
                      >
                        {portrait.pose === "puzzled"
                          ? "!"
                          : portrait.pose === "asking"
                            ? "?"
                            : portrait.pose === "checking"
                              ? "⌕"
                              : "✓"}
                      </text>
                    </g>
                  )}
                  {sleeping && (
                    <text
                      className="sleep-symbol"
                      x="20"
                      y="-12"
                      fontSize="12"
                      fill="#d2d5c2"
                    >
                      z z
                    </text>
                  )}
                  {speaking && typeof spoken === "string" && (
                    <g className="agent-speech" transform="translate(-73 -78)">
                      <title>{spoken}</title>
                      <rect
                        width="146"
                        height="32"
                        rx="9"
                        fill="#e3d2b3"
                        stroke="#f1e1c2"
                      />
                      <path d="m65 32 8 8 8-8" fill="#e3d2b3" />
                      <text
                        x="73"
                        y="20"
                        textAnchor="middle"
                        fontSize="9"
                        fill="#3c4336"
                      >
                        {spoken.length > 27
                          ? spoken.slice(0, 25) + "…"
                          : spoken}
                      </text>
                    </g>
                  )}
                  {!sleeping && !ready && (
                    <circle
                      cx="17"
                      cy="3"
                      r="3.7"
                      fill={COLORS[i % 4]}
                      stroke="#29332d"
                      strokeWidth="2"
                    />
                  )}
                  <rect
                    x="-35"
                    y="22"
                    width="70"
                    height="15"
                    rx="4"
                    fill="#18201c"
                    opacity=".9"
                  />
                  <text
                    x="0"
                    y="32"
                    textAnchor="middle"
                    fontSize="9"
                    fill="#e0e2d0"
                  >
                    {agent.name.split(" ")[0]}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="scene-label">
            <span
              className={`status-dot ${phase === "sleep" ? "sleep" : ""}`}
            />
            {ready ? "Ready for the first day" : nice(phase || "Ready")}
            <span>EVENT-DRIVEN VIEW</span>
          </div>
        </div>
      )}
      <div className="office-progress">
        <div>
          <span>{procurement ? "Decision yield" : "Project milestones"}</span>
          <strong>
            {procurement ? (
              `${((Number(metrics?.decision_yield) || 0) * 100).toFixed(0)}%`
            ) : (
              <>
                {metrics?.completed ?? passed}
                <small> / {metrics?.total ?? tasks.length}</small>
              </>
            )}
          </strong>
        </div>
        <div className="progress-track">
          <i
            style={{
              width: `${Math.min(100, procurement ? Number(metrics?.decision_yield ?? 0) * 100 : progress)}%`,
              background: arm.color,
            }}
          />
        </div>
      </div>
      <div className="agent-roster">
        {agents.map((a, i) => (
          <button
            key={a.id}
            onClick={() => onAgent(a)}
            title={`${a.name} · ${nice(a.role)} · ${nice(a.activity)}. Click for memory.`}
          >
            <Creature role={i % 4} size={36} pose={poses[a.id].pose} />
            <span>
              <strong>{a.name.split(" ")[0]}</strong>
              <small>
                {nice(a.role)} · {poseLabels[poses[a.id].pose]}
              </small>
            </span>
            <span
              className="activity-dot"
              style={{ background: COLORS[i % 4] }}
            />
          </button>
        ))}
      </div>
      <div className="office-bottom">
        <span>
          <Icon name="chat" size={13} />
          {num(metrics?.messages ?? 0)} messages
        </span>
        <span>
          <Icon name="activity" size={13} />
          {num(metrics?.model_calls ?? 0)} model calls
        </span>
        <span
          title={
            typeof spoken === "string"
              ? spoken
              : "All activity comes from the experiment engine"
          }
        >
          {typeof spoken === "string"
            ? `“${spoken.slice(0, 55)}${spoken.length > 55 ? "…" : ""}”`
            : "Waiting for the experiment to begin"}
        </span>
      </div>
    </section>
  );
}
