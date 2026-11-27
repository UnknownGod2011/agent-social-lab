import { Fragment, useState, type CSSProperties } from "react";
import Creature from "./Creature";
import Icon from "./Icon";
import { COLORS, ROLES, nice, type Agent, type LabEvent } from "./types";

type Props = {
  messages: LabEvent[];
  agents: Agent[];
  department: string;
  synthetic: boolean;
  channel: string;
  onReplay: (seq: number) => void;
};

const channelName = (channel?: string) =>
  channel === "notes"
    ? "Private journal"
    : channel === "small_talk"
      ? "Table chat"
      : "Work chat";

export default function ChatTranscript({
  messages,
  agents,
  department,
  synthetic,
  channel,
  onReplay,
}: Props) {
  const [speaker, setSpeaker] = useState("coordinator");
  const roster = agents.filter(
    (a) => department === "all" || a.id.startsWith(department + "-"),
  );
  const names = new Map(agents.map((a) => [a.id, a]));
  const topic = (e: LabEvent) =>
    [
      e.virtual_day,
      e.department_id,
      e.channel,
      e.channel === "notes" ? e.agent_id : "",
    ].join("/");
  return (
    <section className="thread" aria-label="Recorded conversation thread">
      <header className="thread-head">
        <span className="thread-icon">
          <Icon name="chat" size={20} />
        </span>
        <div>
          <h3>
            {department === "all"
              ? "Lab transcripts"
              : "Department " + department}
          </h3>
          <span>
            {synthetic ? "Synthetic recording" : "Recorded model messages"} ·{" "}
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </span>
        </div>
        {channel !== "notes" && (
          <label>
            Align right
            <select
              aria-label="Right-aligned speaker"
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
            >
              <option value="">None</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {roster.find((a) => a.role === role)?.name ?? nice(role)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <ol className="thread-messages">
        {messages.map((e, i) => {
          const person = names.get(e.agent_id ?? ""),
            roleIndex = Math.max(0, ROLES.indexOf(person?.role ?? ""));
          const mine = e.channel !== "notes" && person?.role === speaker;
          const recipient = e.payload_json.recipient_id;
          const contextChange = !i || topic(e) !== topic(messages[i - 1]);
          const recipientName = recipient
            ? (names.get(String(recipient))?.name ?? String(recipient))
            : "";
          const stamp = new Date(e.ts_utc).toISOString();
          return (
            <Fragment key={e.event_id}>
              {contextChange && (
                <li className="thread-divider">
                  <span>
                    Day {e.virtual_day} · {e.department_id} ·{" "}
                    {channelName(e.channel)}
                    {e.channel === "notes" && person ? " · " + person.name : ""}
                  </span>
                </li>
              )}
              <li
                className={
                  "thread-line conversation" +
                  (mine ? " align-right" : "") +
                  (e.channel === "notes" ? " journal-line" : "")
                }
                style={{ "--speaker": COLORS[roleIndex] } as CSSProperties}
              >
                <div className="chat-avatar">
                  <Creature role={roleIndex} size={32} />
                </div>
                <div className="chat-bubble">
                  <div className="chat-author">
                    <strong>{person?.name ?? e.agent_id ?? "Agent"}</strong>
                    {recipientName && <span>to {recipientName}</span>}
                  </div>
                  <p className="chat-text">{String(e.payload_json.text)}</p>
                  <div className="chat-foot">
                    <time dateTime={e.ts_utc} title={stamp}>
                      {stamp.slice(11, 19)} UTC
                    </time>
                  </div>
                  <details className="message-details">
                    <summary>
                      Event #{e.seq}
                      {e.task_id ? " · " + e.task_id : ""}
                    </summary>
                    <dl>
                      <dt>Sender</dt>
                      <dd>{e.agent_id}</dd>
                      <dt>Visibility</dt>
                      <dd>
                        {e.channel === "notes"
                          ? "Author only"
                          : String(e.payload_json.visibility ?? "Department")}
                      </dd>
                      <dt>Recorded</dt>
                      <dd>{stamp}</dd>
                    </dl>
                    <pre>{JSON.stringify(e, null, 2)}</pre>
                    <button onClick={() => onReplay(e.seq)}>
                      Replay this message ↗
                    </button>
                  </details>
                  {e.channel === "notes" && (
                    <small>Notes · Private to this agent</small>
                  )}
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
