import type { Agent, LabEvent } from "./types";
import { useId } from "react";
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

export function workGesture(
  pose: Pose,
  role: number,
): "type" | "review" | "write" | undefined {
  if (
    ![
      "focused",
      "drafting",
      "checking",
      "planning",
      "helping",
      "pleased",
      "asking",
      "puzzled",
    ].includes(pose)
  )
    return;
  if (pose === "checking" || role === 2) return "review";
  return role === 1 ? "type" : "write";
}

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
    let pose: Pose =
      activityPose[agent.activity] ??
      (agent.activity.startsWith("work_block") ? "focused" : "idle");
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
    if (e.event_type === "work_started") pose = "focused";
    if (e.event_type === "sleep_started") pose = "sleeping";
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

// Hand-drawn crew portraits; the same palette and identifying gear appear on the 3D models.
export default function Creature({
  role = 0,
  color,
  size = 42,
  pose = "idle",
}: {
  role?: number;
  color?: string;
  size?: number;
  pose?: Pose;
}) {
  const id = useId().replaceAll(":", ""),
    c = color ?? COLORS[role],
    ink = ["#663b45", "#284c57", "#483957", "#684457"][role];
  const gesture = workGesture(pose, role);
  const closed = pose === "sleeping",
    talk = pose === "talking" || pose === "asking";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`crew-pet pet-${role} pose-${pose}`}
      aria-hidden="true"
      data-gesture={gesture}
    >
      <defs>
        <linearGradient id={id + "fur"} x2=".45" y2="1">
          <stop stopColor={c} />
          <stop offset=".7" stopColor={c} />
          <stop offset="1" stopColor={ink} />
        </linearGradient>
      </defs>
      <g
        stroke={ink}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <g className="pet-feet" fill={ink}>
          <ellipse cx="22" cy="57" rx="7" ry="3.3" />
          <ellipse cx="42" cy="57" rx="7" ry="3.3" />
        </g>
        <g
          transform={
            pose === "sleeping" ? "translate(2 3) rotate(-16 32 46)" : undefined
          }
        >
          <g className="pet-torso">
            {role === 0 && (
              <path d="M43 46q13-1 16-14 5 18-12 22" fill="#ee9869" />
            )}
            {role === 3 && (
              <path d="M45 47q14-5 13-15 8 20-11 23" fill="#e28b91" />
            )}
            <path
              d="M16 42q0-12 16-13 17 0 17 16v5q-2 8-17 8-16 0-17-8z"
              fill={["#c46c52", "#4e9096", "#8c74ad", "#b76e79"][role]}
            />
            <path
              d="M23 46q8 4 18-1v8q-8 4-18 0z"
              fill={["#f3ce97", "#b4e7cf", "#ddd0f5", "#f2c6b0"][role]}
              stroke="none"
            />
            <g className="pet-head">
              {role === 0 && (
                <>
                  <path
                    d="M12 29 11 7q0-4 3-2l14 13M38 17 51 6q3-2 3 1l-2 23"
                    fill={c}
                  />
                  <path
                    d="m15 11 1 12 8-4m18 1 8-9-1 13"
                    fill="#d78278"
                    stroke="none"
                  />
                </>
              )}
              {role === 1 && (
                <g fill={c}>
                  <circle cx="13" cy="29" r="8" />
                  <circle cx="51" cy="29" r="8" />
                </g>
              )}
              {role === 2 && (
                <>
                  <path
                    d="M17 25Q3 2 14 3q9 1 13 18m6-2Q38-3 46 3q7 5-5 19"
                    fill={c}
                  />
                  <path
                    d="m14 8 7 12m20-12-5 11"
                    stroke="#f0c1d6"
                    strokeWidth="4"
                  />
                </>
              )}
              {role === 3 && (
                <>
                  <path
                    d="m15 35-11-3 5-5-6-5q10-3 17 1m25 11 14-3-5-5 6-5q-10-3-18 1"
                    fill="#ec9da6"
                  />
                  <path
                    d="M31 22Q15 14 22 5q11 1 11 12Q35 3 46 5q2 10-13 15"
                    fill="#a4d6a3"
                    stroke="#52877c"
                  />
                </>
              )}
              <path
                d={
                  role === 0
                    ? "M10 30q1-14 22-14 21 0 22 14l2 10-6-2q-2 10-18 11-16-1-20-10l-5 2z"
                    : role === 1
                      ? "M10 30q0-15 21-15 21-1 23 14l1 9q0 12-22 12-22 0-23-12z"
                      : "M10 31q0-15 22-16 22 0 23 17 1 17-22 18-24 0-23-19z"
                }
                fill={`url(#${id}fur)`}
              />
              {role === 0 && (
                <path
                  d="m11 33 11 4 10-4 9 3 12-5q-2 16-20 16-18 0-22-14"
                  fill="#ffe3b2"
                  stroke="none"
                />
              )}
              {role === 1 && (
                <>
                  <path
                    d="M14 23Q13 6 30 6q15 0 18 13l4 2-1 4-37 3-4-3z"
                    fill="#edac58"
                  />
                  <path
                    d="m28 9-2 11m9-11 2 10"
                    stroke="#ffda8b"
                    strokeWidth="3"
                  />
                  <path d="m12 24 39-3" stroke="#ffe5a5" strokeWidth="3" />
                </>
              )}
              {role === 2 && (
                <path
                  d="M12 29q7-5 17-1l5 1q9-6 18-1l-2 9q-8 6-15-1l-3-4-3 5q-8 5-15-1z"
                  fill="#e4d5f5"
                  stroke="#68527f"
                  strokeWidth="2.3"
                />
              )}
              <g className="pet-gaze">
                <g
                  className={closed ? "" : "pet-blink"}
                  fill={ink}
                  stroke={ink}
                >
                  {closed ? (
                    <path
                      d="m20 33q3 3 6-1m12 1q3 3 6-1"
                      fill="none"
                      strokeWidth="2.2"
                    />
                  ) : (
                    <>
                      <ellipse cx="23" cy="32" rx="2.4" ry="3.3" />
                      <ellipse cx="40.3" cy="32" rx="2.4" ry="3.3" />
                      <path
                        d="M23.6 30.6h.3m17 0h.3"
                        stroke="#fff"
                        strokeWidth="1.5"
                      />
                    </>
                  )}
                </g>
              </g>
              <path
                d="m16 37 4 1m23 0 4-1"
                stroke="#d98686"
                strokeWidth="2.4"
              />
              {talk ? (
                <ellipse cx="32" cy="40.5" rx="3" ry="3.5" fill="#74464e" />
              ) : (
                <path d="m29 39q3 4 7-1" fill="none" />
              )}
              {role === 0 && <path d="m29.5 35 5-.2-2.5 2.6z" fill={ink} />}
            </g>
            {!gesture && (
              <>
                <path className="pet-arm" d="M45 46q5-5 8-1 2 6-6 7" fill={c} />
                <path d="M17 45q-6-3-7 2 0 5 7 5" fill={c} />
              </>
            )}
            {role === 0 && <path d="m20 47 14 2-4 8-7-7z" fill="#e87970" />}
            {role === 1 && (
              <g fill="#547b88">
                <path d="M21 47v7h21v-7m-17 1v5m13-5v5" />
                <path d="M29 51h6v3h-6" fill="#f4d58a" />
              </g>
            )}
            {role === 2 && <path d="m40 47 7 5 6-9-7-4z" fill="#91cfc8" />}
            {role === 3 && (
              <path d="M19 46q9 4 17 3l-9 6-4-6z" fill="#67a899" />
            )}
            {gesture && (
              <g className="pet-workbench">
                {gesture === "type" ? (
                  <g>
                    <path
                      d="m11 49 38-1 6 9-45 1z"
                      stroke="#354a61"
                      fill="#6c8395"
                    />
                    <path
                      d="m15 52 29-.7m-27 3 31-.7"
                      stroke="#d4e7e2"
                      strokeWidth="1.3"
                      strokeDasharray="2.4 1.5"
                    />
                  </g>
                ) : (
                  <g className="work-page">
                    <path
                      d="m19 47 23-4 6 13-25 5z"
                      fill={gesture === "review" ? "#a9ded7" : "#f7e6c8"}
                      stroke="#5e6b72"
                    />
                    <path
                      d="m25 49 12-2m-11 5 10-2m-9 5 7-1"
                      stroke="#758c90"
                      strokeWidth="1"
                    />
                  </g>
                )}
                <g className="work-paw left-paw">
                  <path
                    d="M16 44q3 0 5 4l2 3q-2 5-7 2l-4-4q-2-4 4-5z"
                    fill={c}
                  />
                </g>
                <g className="work-paw right-paw">
                  {gesture === "write" && (
                    <path
                      d="m37 53 8-15 3 1-9 15-3 1z"
                      fill="#e9b66d"
                      strokeWidth="1.1"
                    />
                  )}
                  {gesture === "review" && (
                    <g stroke="#415669">
                      <path d="m36 48 6 6" strokeWidth="3" />
                      <circle
                        cx="34"
                        cy="45"
                        r="5.5"
                        fill="#d7f4ee"
                        fillOpacity=".7"
                        strokeWidth="2"
                      />
                    </g>
                  )}
                  <path
                    d="M49 44q3 1 1 5l-5 4q-4 1-5-2-1-2 3-5 3-4 6-2z"
                    fill={c}
                  />
                </g>
              </g>
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}
