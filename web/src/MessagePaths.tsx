import { useId, useMemo, useState } from "react";
import type { Agent, Department, LabEvent } from "./types";
import Creature from "./Creature";
export default function MessagePaths({
  department,
  events,
  onAgent,
  onReplay,
}: {
  department: Department;
  events: LabEvent[];
  onAgent: (a: Agent) => void;
  onReplay: (n: number) => void;
}) {
  const [chosen, setChosen] = useState(""),
    uid = useId().replaceAll(":", "");
  const { agents, id } = department;
  const edges = useMemo(() => {
    const map = new Map<
      string,
      { from: number; to: number; kind: string; events: LabEvent[] }
    >();
    const add = (from: number, to: number, kind: string, e: LabEvent) => {
      if (from < 0 || to < 0 || from === to) return;
      const key = [from, to, kind].join(":");
      const r = map.get(key) ?? { from, to, kind, events: [] };
      r.events.push(e);
      map.set(key, r);
    };
    for (const e of events) {
      if (e.department_id !== id) continue;
      const p = e.payload_json;
      if (
        e.event_type === "message_sent" &&
        ["work", "small_talk"].includes(e.channel ?? "")
      ) {
        const to = p.recipient_id
          ? agents.findIndex((a) => a.id === p.recipient_id)
          : 4;
        add(
          agents.findIndex((a) => a.id === e.agent_id),
          to,
          e.channel === "small_talk" ? "Table" : "Work",
          e,
        );
      }
      if (Array.isArray(p.cooperation_uses))
        for (const u of p.cooperation_uses)
          add(
            agents.findIndex((a) => a.id === u.sender_id),
            agents.findIndex((a) => a.id === u.recipient_id),
            "Cooperation",
            e,
          );
    }
    return map;
  }, [events, agents, id]);
  const points = [
    [84, 55],
    [306, 55],
    [84, 158],
    [306, 158],
    [195, 106],
  ];
  const edge = edges.get(chosen) ?? [...edges.values()][0],
    name = (i: number) => (i === 4 ? "Department" : agents[i]?.name);
  return (
    <div className="communication">
      <svg
        viewBox="0 0 390 207"
        aria-label={"Recorded communication network for department " + id}
      >
        <defs>
          <pattern
            id={uid}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".8" fill="#45516b" />
          </pattern>
        </defs>
        <rect width="390" height="207" rx="12" fill={`url(#${uid})`} />
        {[...edges].map(([key, e]) => {
          const [x, y] = points[e.from],
            [xx, yy] = points[e.to],
            bend = e.kind === "Table" ? 19 : e.kind === "Cooperation" ? -16 : 5;
          const cx = (x + xx) / 2 - (yy - y) * 0.08,
            cy = (y + yy) / 2 + (xx - x) * 0.08 + bend;
          const path = `M${x} ${y}Q${cx} ${cy} ${xx} ${yy}`;
          return (
            <g key={key} onClick={() => setChosen(key)}>
              <title>
                {name(e.from)} → {name(e.to)} · {e.kind} · {e.events.length}
              </title>
              <path
                d={path}
                stroke="transparent"
                strokeWidth="14"
                fill="none"
              />
              <path
                d={path}
                stroke={
                  e.kind === "Table"
                    ? "#eaa67b"
                    : e.kind === "Cooperation"
                      ? "#bc9ce7"
                      : "#71b9c9"
                }
                strokeDasharray={e.kind === "Table" ? "4 3" : undefined}
                strokeWidth={1 + Math.log2(1 + e.events.length)}
                fill="none"
                opacity={e === edge ? 1 : 0.63}
              />
            </g>
          );
        })}
        {agents.map((a, i) => (
          <g key={a.id} transform={`translate(${points[i]})`}>
            <circle r="24" fill="#24324b" stroke="#61738d" />
            <g transform="translate(-23 -25)">
              <Creature role={i} size={46} />
            </g>
            <text y="37" textAnchor="middle">
              {a.name}
            </text>
          </g>
        ))}
        <g transform="translate(195 106)">
          <circle r="12" fill="#30405b" stroke="#91a5bb" />
          <path d="M-4 1h8m-6-4h4m-4 8h4" stroke="#e4cdad" />
          <text y="25" textAnchor="middle">
            Department
          </text>
        </g>
      </svg>
      <select
        aria-label="Inspect network connection"
        disabled={!edge}
        value={edge ? [...edges].find(([, v]) => v === edge)?.[0] : ""}
        onChange={(e) => setChosen(e.target.value)}
      >
        {!edge && <option>No communication recorded</option>}
        {[...edges].map(([k, e]) => (
          <option key={k} value={k}>
            {name(e.from)} → {name(e.to)} · {e.kind} · {e.events.length}
          </option>
        ))}
      </select>
      {edge && (
        <div className="network-links">
          <button onClick={() => onReplay(edge.events.at(-1)!.seq)}>
            Inspect event #{edge.events.at(-1)!.seq} ↗
          </button>
          <button onClick={() => onAgent(agents[edge.from])}>
            Inspect sender ↗
          </button>
        </div>
      )}
    </div>
  );
}
