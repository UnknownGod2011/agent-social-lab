import { useId, useState } from "react";
import Creature from "./Creature";
import type { Agent, Department, LabEvent } from "./types";
import { nice } from "./types";

const nodes = [
  [99, 75],
  [301, 75],
  [99, 225],
  [301, 225],
];

export default function MessagePaths({
  department,
  events,
  onAgent,
  onReplay,
}: {
  department: Department;
  events: LabEvent[];
  onAgent: (a: Agent) => void;
  onReplay: (seq: number) => void;
}) {
  const uid = useId().replaceAll(":", "");
  const { agents, id } = department;
  const [selected, setSelected] = useState("");
  const edges = new Map<
    string,
    { from: number; to: number; items: LabEvent[] }
  >();
  for (const event of events) {
    if (
      event.department_id !== id ||
      event.channel !== "work" ||
      event.event_type !== "message_sent"
    )
      continue;
    const from = agents.findIndex((a) => a.id === event.agent_id);
    const to = agents.findIndex(
      (a) => a.id === event.payload_json.recipient_id,
    );
    if (from < 0 || to < 0 || from === to) continue;
    const key = from + "-" + to;
    const edge = edges.get(key) ?? { from, to, items: [] };
    edge.items.push(event);
    edges.set(key, edge);
  }
  const latest = [...edges.entries()].sort(
    (a, b) => b[1].items.at(-1)!.seq - a[1].items.at(-1)!.seq,
  );
  const edge = edges.get(selected) ?? latest[0]?.[1];
  const last = edge?.items.at(-1);
  return (
    <div className="message-paths">
      <svg
        className="path-plot"
        viewBox="0 0 400 285"
        role="group"
        aria-label={`Addressed work messages, department ${id}`}
      >
        <defs>
          <pattern
            id={"dots" + uid}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".8" fill="#53605e" />
          </pattern>
          <marker
            id={"arrow" + uid}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 1l9 4-9 4" fill="#c7d2b0" />
          </marker>
        </defs>
        <rect width="400" height="285" fill={`url(#dots${uid})`} />
        {latest.map(([key, e]) => {
          const [x1, y1] = nodes[e.from],
            [x2, y2] = nodes[e.to];
          const dx = x2 - x1,
            dy = y2 - y1,
            len = Math.hypot(dx, dy),
            ux = dx / len,
            uy = dy / len;
          const d = `M ${x1 + ux * 32 - uy * 5} ${y1 + uy * 32 + ux * 5} L ${x2 - ux * 36 - uy * 5} ${y2 - uy * 36 + ux * 5}`;
          return (
            <g key={key}>
              <path
                d={d}
                stroke={e === edge ? "#f0cc92" : "#a2bea6"}
                strokeWidth={e === edge ? 3 : 2}
                markerEnd={`url(#arrow${uid})`}
                opacity={e === edge ? 1 : 0.65}
              />
            </g>
          );
        })}
        {agents.map((agent, i) => (
          <g
            key={agent.id}
            transform={`translate(${nodes[i][0]} ${nodes[i][1]})`}
            role="button"
            tabIndex={0}
            aria-label={`Inspect ${agent.name}, ${agent.role}`}
            onClick={() => onAgent(agent)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAgent(agent);
              }
            }}
            className="path-node"
          >
            <circle r="29" fill="#24312e" stroke="#687b6f" />
            <g transform="translate(-24 -27)">
              <Creature role={i} size={47} />
            </g>
            <rect x="-47" y="28" width="94" height="17" rx="8" fill="#1c2523" />
            <text y="40" textAnchor="middle" fill="#e5eadf" fontSize="12">
              {agent.name}
            </text>
          </g>
        ))}
      </svg>
      <div className="path-observation">
        {edge && last ? (
          <>
            <label>
              Message path
              <select
                value={edge.from + "-" + edge.to}
                onChange={(e) => setSelected(e.target.value)}
              >
                {latest.map(([key, e]) => (
                  <option key={key} value={key}>
                    {agents[e.from].name} → {agents[e.to].name} ·{" "}
                    {e.items.length}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => onReplay(last.seq)}>
              Last message · #{last.seq} ↗
            </button>
          </>
        ) : (
          <span>{nice("no_addressed_work_messages_recorded")}</span>
        )}
      </div>
    </div>
  );
}
