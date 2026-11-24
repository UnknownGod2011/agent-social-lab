import type { Agent, LabEvent } from "./types";
import { COLORS } from "./types";

export const poseLabels = {
  idle: "Ready",
  planning: "Planning",
  focused: "Working",
  puzzled: "Blocked",
  helping: "Sharing",
  checking: "Checking",
  drafting: "Writing",
  pleased: "Submitted",
  asking: "Asking",
  talking: "Speaking",
  listening: "Listening",
  resting: "Resting",
  sleeping: "Sleeping",
  walking: "Walking",
  waiting: "Waiting",
} as const;
export type Pose = keyof typeof poseLabels;

const actionPose: Record<string, Pose> = {
  claim_task: "planning",
  submit_artifact: "drafting",
  review_artifact: "checking",
  complete_milestone: "pleased",
  request_help: "asking",
  send_work_message: "helping",
  journal_non_task: "drafting",
  wait: "waiting",
  share_evidence: "helping",
  request_evidence: "asking",
  award_contract: "pleased",
};

export function getPoses(agents: Agent[], events: LabEvent[], phase?: string) {
  const activityPose: Record<string, Pose> = {
    sleeping: "sleeping",
    working: "focused",
    planning: "planning",
    waking: "idle",
    walking: "walking",
    talking: "listening",
    break: "resting",
  };
  const result: Record<string, { pose: Pose; evidence?: LabEvent }> = {};
  for (const agent of agents) {
    let pose: Pose = activityPose[agent.activity] ?? "idle";
    if (agent.activity === "walking")
      pose =
        phase === "planning"
          ? "planning"
          : phase?.startsWith("work")
            ? "focused"
            : "idle";
    if (phase === "break")
      pose = agent.location === "table" ? "listening" : "resting";
    result[agent.id] = { pose };
  }
  // A pose has the lifetime of the phase that produced it, including during replay.
  let start = events.length - 1;
  while (start >= 0 && events[start].event_type !== "phase_started") start--;
  for (const e of events.slice(start + 1)) {
    if (!e.agent_id || !result[e.agent_id]) continue;
    const action = e.payload_json.action as { type?: string } | undefined;
    let pose: Pose | undefined;
    if (e.event_type === "action_rejected") pose = "puzzled";
    if (e.event_type === "action_accepted")
      pose = actionPose[action?.type ?? ""];
    if (e.event_type === "message_sent" && e.channel === "small_talk") {
      for (const id of Object.keys(result))
        result[id] = { pose: "listening", evidence: e };
      pose = "talking";
    }
    if (pose) result[e.agent_id] = { pose, evidence: e };
  }
  return result;
}

function Face({ pose }: { pose: Pose }) {
  const eyesClosed = ["sleeping", "pleased", "resting"].includes(pose);
  const looking = ["planning", "checking", "asking"].includes(pose) ? 1.4 : 0;
  return (
    <>
      <g
        className={eyesClosed ? "" : "creature-eyes"}
        fill="#252b31"
        stroke="#252b31"
        strokeWidth="1.9"
        strokeLinecap="round"
      >
        {eyesClosed ? (
          <path
            d={
              pose === "pleased"
                ? "M16 29q3-4 6 0m5 0q3-4 6 0"
                : "M16 28q3 3 6 0m5 0q3 3 6 0"
            }
            fill="none"
          />
        ) : (
          <g transform={`translate(${looking} 0)`} stroke="none">
            <ellipse
              cx="19"
              cy="28"
              rx={pose === "checking" ? 2.8 : 2.15}
              ry={pose === "focused" ? 1.7 : 2.9}
            />
            <ellipse
              cx="30"
              cy="28"
              rx="2.15"
              ry={pose === "puzzled" ? 2 : 2.9}
            />
            <g fill="#fff7db">
              <circle cx="19.6" cy="27" r=".65" />
              <circle cx="30.6" cy="27" r=".65" />
            </g>
          </g>
        )}
        {pose === "puzzled" && <path d="m15 23 6 1m6 0 5-3" />}
        {pose === "focused" && <path d="m16 24 4 1m8 0 4-1" />}
      </g>
      {["talking", "asking", "sleeping"].includes(pose) ? (
        <ellipse
          cx="24.5"
          cy="34"
          rx={pose === "talking" ? 3 : 1.5}
          ry={pose === "talking" ? 2.6 : 1.8}
          fill="#614646"
        />
      ) : (
        <path
          d={
            pose === "puzzled"
              ? "M21 35q3-3 6-1"
              : pose === "waiting"
                ? "M22 34h5"
                : "M21 33q3 4 7 0"
          }
          fill="none"
          stroke="#6a4842"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </>
  );
}

export default function Creature({
  role = 0,
  color,
  size = 36,
  pose = "idle",
}: {
  role?: number;
  color?: string;
  size?: number;
  pose?: Pose;
}) {
  const c = color ?? COLORS[role];
  return (
    <svg
      className={`creature-sprite pose-${pose}`}
      width={size}
      height={size}
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="25" cy="45" rx="14" ry="2.6" fill="#121821" opacity=".3" />
      <g
        className="creature-feet"
        stroke={c}
        strokeWidth="4.3"
        strokeLinecap="round"
      >
        <path className="foot-left" d="m18 39-1 4" />
        <path className="foot-right" d="m31 39 1 4" />
      </g>
      <g className="creature-body">
        {role === 0 && (
          <g fill={c}>
            <path d="M12 22 8 7q0-2 2-1l14 12m5 0L38 6q2-1 2 1l-2 16" />
            <path d="m11 10 3 9 5-1m15-1 3-6-1 9" fill="#ae765d" />
          </g>
        )}
        {role === 1 && (
          <g>
            <ellipse cx="11" cy="23" rx="5" ry="6" fill={c} />
            <ellipse cx="38" cy="23" rx="5" ry="6" fill={c} />
          </g>
        )}
        {role === 2 && (
          <g fill={c}>
            <path d="M16 21Q5 9 12 4q6-2 11 15m3 1Q26 5 33 4q7 1 0 17" />
            <path
              d="m14 8 5 9m13-9-3 9"
              stroke="#d3bbd4"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        )}
        {role === 3 && (
          <g fill={c}>
            <path d="M13 24Q3 21 4 13l11 3M35 24q11-3 10-11l-11 3" />
            <path
              d="M21 16q-6-8-1-12 5 1 5 8 2-9 8-8 1 7-6 11"
              fill="#9fb78d"
            />
          </g>
        )}
        <path
          d={
            role === 1
              ? "M9 27q1-13 15-13t16 13v7q0 9-11 9h-9Q9 43 9 34Z"
              : role === 3
                ? "M9 29q0-15 16-15t16 15q0 13-16 13T9 29Z"
                : "M10 29q0-15 15-15t15 15q0 13-15 13T10 29Z"
          }
          fill={c}
        />
        <path
          d="M12 34q5 7 14 7 8 0 13-6-1 8-14 8-11 0-13-9Z"
          fill="#483e42"
          opacity=".16"
        />
        {role === 0 && (
          <path
            d="m21 17 3-4 2 4 3-3"
            stroke="#efcb88"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
        {role === 1 && (
          <g>
            <path
              d="M12 20q-1-11 12-12 12-1 14 11l-6 2-1-4q-8 3-19 3Z"
              fill="#d9b46f"
            />
            <path d="M12 19q10 0 18-4l3 5q-9 4-21 3Z" fill="#f1d094" />
          </g>
        )}
        <ellipse
          cx="14"
          cy="32"
          rx="3.1"
          ry="1.6"
          fill="#c76f71"
          opacity=".5"
        />
        <ellipse
          cx="35"
          cy="32"
          rx="3.1"
          ry="1.6"
          fill="#c76f71"
          opacity=".5"
        />
        <Face pose={pose} />
        {role === 2 && (
          <g stroke="#5a4c66" strokeWidth="1.35">
            <circle cx="18.9" cy="28" r="5" />
            <circle cx="30.4" cy="28" r="5" />
            <path d="M24 28h1.3" />
          </g>
        )}
        {role === 0 && <path d="m16 39 8 2 8-3-7 5Z" fill="#9c6659" />}
        {role === 1 && (
          <path
            d="M17 38v2q8 3 16-1v-2m-13 4 1-3h7l1 3"
            stroke="#6b817a"
            strokeWidth="2"
          />
        )}
        {role === 3 && (
          <path
            d="m13 37 5 1-3 2m20-3-5 2 4 1"
            stroke="#a06e61"
            strokeWidth="1.2"
          />
        )}
        {pose === "drafting" && (
          <g className="writing-tool">
            <path d="m34 36 8-10 2 2-8 10-3 1Z" fill="#ecd179" />
            <path d="m33 39 1-3 2 2Z" fill="#484141" />
          </g>
        )}
        {pose === "checking" && (
          <g stroke="#645642" strokeWidth="2.4">
            <circle cx="36" cy="31" r="4.6" fill="#a6d0ce" fillOpacity=".5" />
            <path d="m39 34 4 5" />
          </g>
        )}
        {pose === "helping" && (
          <g transform="rotate(-8 38 37)">
            <rect x="32" y="31" width="12" height="9" rx="1.4" fill="#ece2ba" />
            <path d="m33 32 5 4 5-4" stroke="#82785a" />
          </g>
        )}
      </g>
    </svg>
  );
}
