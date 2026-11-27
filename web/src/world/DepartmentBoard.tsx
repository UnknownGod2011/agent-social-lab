import { memo, useMemo, useState, type CSSProperties } from "react";
import Icon from "../Icon";
import { getPoses } from "../Creature";
import { LensPicker } from "../TeamReadout";
import { teamMeasures, type Lens } from "../teamMeasures";
import {
  ARMS,
  minute,
  nice,
  type Arm,
  type Department,
  type LabEvent,
  type Run,
  type State,
} from "../types";
import { destination } from "./layout";
import Room2D from "./Room2D";
import { names, roomAccents, sceneModel } from "./roomDesign";

const RoomPreview = memo(function RoomPreview({
  d,
  events,
  phase,
}: {
  d: Department;
  events: LabEvent[];
  phase: string;
}) {
  const room = useMemo(() => sceneModel(d.id), [d.id]);
  const poses = getPoses(
    d.agents,
    events.filter((e) => !e.department_id || e.department_id === d.id),
    phase,
  );
  const positions = Object.fromEntries(
    d.agents.map((a, i) => [
      a.id,
      { ...destination(a, i), moving: false, facing: 1 },
    ]),
  );
  return (
    <div className="board-room" inert aria-hidden="true">
      <Room2D
        room={room}
        agents={d.agents}
        positions={positions}
        poses={poses}
        selected=""
        onPick={() => {}}
        onMove={() => {}}
        active={false}
        reduced
        phase={phase}
        accent={roomAccents[d.id]}
      />
    </div>
  );
});

export default function DepartmentBoard({
  departments,
  run,
  state,
  events,
  seq,
  onExpand,
  onReplay,
}: {
  departments: Department[];
  run: Run;
  state: State;
  events: LabEvent[];
  seq: number;
  onExpand: (arm: Arm) => void;
  onReplay: (seq: number) => void;
}) {
  const [lens, setLens] = useState<Lens>("Outcomes");
  const measures = teamMeasures(run, lens);
  const latest = useMemo(() => {
    const messages = new Map<Arm, LabEvent>();
    for (const event of events) {
      if (
        event.department_id &&
        event.event_type === "message_sent" &&
        event.channel === "work"
      )
        messages.set(event.department_id, event);
    }
    return messages;
  }, [events]);
  return (
    <div className="department-board">
      <div className="board-toolbar">
        <div className="board-clock">
          <Icon name="clock" size={14} /> Day {state.virtual_day} ·{" "}
          {minute(state.virtual_minute)}
          <span>Event #{seq}</span>
        </div>
        <LensPicker lens={lens} onChange={setLens} />
      </div>
      <table
        className="board-matrix"
        data-count={departments.length}
        aria-label="Department comparison at displayed event"
      >
        <colgroup>
          <col className="measure-column" />
          {departments.map((d) => (
            <col key={d.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="board-key">
              <span className="overline">Conditions</span>
              <strong>{departments.length}</strong>
              <small>{nice(state.phase)}</small>
            </th>
            {departments.map((d) => (
              <th key={d.id} scope="col">
                <button
                  className="mini-room board-room-link"
                  style={{ "--dept-tone": ARMS[d.id].color } as CSSProperties}
                  onClick={() => onExpand(d.id)}
                  aria-label={"Expand Department " + d.id}
                >
                  <RoomPreview d={d} events={events} phase={state.phase} />
                  <span className="board-arm">
                    <b>{d.id}</b>
                    <span>{ARMS[d.id].title}</span>
                    <Icon name="arrow" size={15} />
                  </span>
                  <span className="board-room-name">{names[d.id]}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {measures.map((m, i) => (
            <tr
              key={m.label}
              className={i === 0 ? "principal-measure" : undefined}
            >
              <th scope="row">{m.label}</th>
              {departments.map((d) => {
                const metrics = run.metrics?.departments[d.id];
                return <td key={d.id}>{metrics ? m.value(metrics) : "—"}</td>;
              })}
            </tr>
          ))}
          <tr className="board-evidence">
            <th scope="row">Latest work message</th>
            {departments.map((d) => {
              const event = latest.get(d.id);
              const sender = d.agents.find(
                (a) => a.id === event?.agent_id,
              )?.name;
              return (
                <td key={d.id}>
                  {event ? (
                    <details>
                      <summary>
                        {sender ?? "Team"} <span>#{event.seq}</span>
                      </summary>
                      <p>{String(event.payload_json.text ?? "")}</p>
                      <button onClick={() => onReplay(event.seq)}>
                        View event #{event.seq}
                      </button>
                    </details>
                  ) : (
                    "No work messages yet"
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
