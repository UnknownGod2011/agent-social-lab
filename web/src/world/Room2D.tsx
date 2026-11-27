import { memo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import Creature, { poseLabels, type Pose } from "../Creature";
import type { Agent } from "../types";
import {
  project,
  unproject,
  viewBox,
  type Solid,
  type Prop,
  type Illustration,
  type Point,
} from "./layout";
import type { Walker } from "./motion";
import { dataImage } from "./art";

const shade = (c: string, n: number) =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.max(
        0,
        Math.min(255, Math.round(parseInt(c.slice(i, i + 2), 16) * n)),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function SolidShape({ s }: { s: Solid }) {
  const { x, y, z, w, h, d, color } = s,
    [cx, cy] = project(x, z, y + h);
  if (s.shape === "leaf") {
    const rx = (w * (57 + 1.32 * z)) / 2,
      ry = (h * (47 + 0.8 * z)) / 2;
    return (
      <g>
        <ellipse cx={cx} cy={cy + ry} rx={rx} ry={ry} fill={color} />
        <path
          d={`M${cx} ${cy + ry * 1.9}q3 -${ry} 0 -${ry * 1.65}`}
          stroke={shade(color, 0.74)}
          fill="none"
          strokeWidth=".8"
        />
      </g>
    );
  }
  if (s.shape === "round") {
    const rx = (w * (57 + 1.32 * z)) / 2,
      ry = d * 16.875;
    return (
      <g>
        <path
          d={`M${cx - rx},${cy}v${(47 + z * 0.8) * h}a${rx},${ry} 0 0 0 ${2 * rx},0v-${(47 + z * 0.8) * h}Z`}
          fill={shade(color, 0.74)}
        />
        <ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill={color}
          stroke={shade(color, 1.13)}
          strokeWidth=".65"
        />
      </g>
    );
  }
  const px = (a: number, b: number, l: number) =>
    project(x + (a * w) / 2, z + (b * d) / 2, y + l * h).join(",");
  const face = (p: string[], c: string) => (
    <polygon
      points={p.join(" ")}
      fill={c}
      stroke={shade(c, 0.94)}
      strokeWidth=".6"
      strokeLinejoin="round"
    />
  );
  return (
    <g className={s.glow && h < 0.04 ? "monitor-light" : undefined}>
      {face(
        [px(-1, 1, 0), px(1, 1, 0), px(1, 1, 1), px(-1, 1, 1)],
        shade(color, 0.78),
      )}
      {face(
        [
          px(x < 6 ? 1 : -1, -1, 0),
          px(x < 6 ? 1 : -1, 1, 0),
          px(x < 6 ? 1 : -1, 1, 1),
          px(x < 6 ? 1 : -1, -1, 1),
        ],
        shade(color, 0.6),
      )}
      {face([px(-1, -1, 1), px(1, -1, 1), px(1, 1, 1), px(-1, 1, 1)], color)}
    </g>
  );
}
function WallArt({ a }: { a: Illustration }) {
  const [u, v] = project(a.x, a.z, a.y + a.h);
  return (
    <image
      href={dataImage(a.art)}
      width={a.w}
      height={a.h}
      preserveAspectRatio="none"
      transform={`matrix(${a.wall === "back" ? 57 + 1.32 * a.z + " 0" : "7.92 -33.75"} 0 ${47 + a.z * 0.8} ${u} ${v})`}
    />
  );
}
const Furniture = memo(function Furniture({ p }: { p: Prop }) {
  const [u, v] = project(p.x, p.z, 0.08);
  return (
    <g>
      {p.radius && (
        <ellipse
          cx={u + 3}
          cy={v + 4}
          rx={(p.radius[0] + p.radius[1]) * 21}
          ry={(p.radius[0] + p.radius[1]) * 7.5}
          fill="#1b2945"
          opacity=".33"
        />
      )}
      {p.pieces.map((s, i) => (
        <SolidShape key={i} s={s} />
      ))}
      {p.art && <WallArt a={p.art} />}
    </g>
  );
});
export type SceneProps = {
  room: Prop[];
  agents: Agent[];
  positions: Record<string, Walker>;
  poses: Record<string, { pose: Pose }>;
  selected: string;
  onPick: (a: Agent) => void;
  onMove: (id: string, p: Point) => void;
  active: boolean;
  reduced: boolean;
  phase: string;
  accent: string;
};
export default function Room2D({
  room,
  agents,
  positions,
  poses,
  selected,
  onPick,
  onMove,
  phase,
}: SceneProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ a: Agent; x: number; y: number } | null>(null);
  const [marker, setMarker] = useState<Point | null>(null);
  function floor(e: PointerEvent) {
    const mat = svg.current!.getScreenCTM()!,
      p = new DOMPoint(e.clientX, e.clientY).matrixTransform(mat.inverse());
    return unproject(p.x, p.y);
  }
  const targets = marker
    ? [marker]
    : Object.values(positions).flatMap((p) => (p.target ? [p.target] : []));
  const things = room.map((p, i) => ({
    depth: p.base ? -2000 + i * 0.01 : p.z * 33.75,
    element: <Furniture key={"p" + i} p={p} />,
  }));
  agents.forEach((a, i) => {
    const p = positions[a.id];
    if (!p) return;
    const [u, v] = project(p.x, p.z, 0.12),
      pose = poses[a.id]?.pose ?? "idle";
    things.push({
      depth: p.z * 33.75 + 2,
      element: (
        <g
          key={a.id}
          className={"stage-pet" + (selected === a.id ? " picked" : "")}
          data-agent={a.id}
          data-x={p.x}
          data-z={p.z}
          data-pose={pose}
          data-moving={p.moving}
          transform={`translate(${u} ${v})`}
          role="button"
          tabIndex={0}
          aria-label={`${a.name}, ${a.role}, ${poseLabels[pose]}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(a);
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            drag.current = { a, x: e.clientX, y: e.clientY };
            svg.current?.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current) return;
            const b = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty(
              "--look",
              Math.sign(e.clientX - b.left - b.width / 2) + "px",
            );
          }}
        >
          <rect x="-33" y="-59" width="66" height="77" fill="transparent" />
          <title>
            {a.name} · {a.role} · {poseLabels[pose]} · {a.id.split("-")[0]}
            {poses[a.id] && a.memory.at(-1)?.action?.task_id
              ? " · " + a.memory.at(-1)?.action?.task_id
              : ""}
          </title>
          <ellipse cy="0" rx="19" ry="6.8" fill="#1a2943" opacity=".56" />
          <ellipse
            className="pick-ring"
            cy="0"
            rx="22"
            ry="8"
            fill="none"
            stroke="#f1c69f"
            strokeWidth="1.5"
          />
          <g
            transform={`translate(-29 -52)`}
            style={{ "--pet-delay": -i * 1.31 + "s" } as CSSProperties}
          >
            <g
              transform={
                p.facing < 0 ? "translate(58 0) scale(-1 1)" : undefined
              }
            >
              <Creature role={i} size={58} pose={p.moving ? "walking" : pose} />
            </g>
          </g>
          <rect
            x="-20"
            y="3"
            width="40"
            height="12"
            rx="5.5"
            fill="#1c283e"
            stroke="#7389a0"
            strokeWidth=".65"
          />
          <text
            y="12"
            textAnchor="middle"
            fill="#fcf0db"
            fontSize="9"
            fontWeight="700"
          >
            {a.name}
          </text>
        </g>
      ),
    });
  });
  return (
    <svg
      ref={svg}
      className={"room-vector phase-" + phase}
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-label="Interactive department floor plan"
      role="group"
      onPointerMove={(e) => {
        if (
          drag.current &&
          Math.hypot(drag.current.x - e.clientX, drag.current.y - e.clientY) > 5
        )
          setMarker(floor(e));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setMarker(null);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        setMarker(null);
        onPick(d.a);
        if (Math.hypot(d.x - e.clientX, d.y - e.clientY) > 5)
          onMove(d.a.id, floor(e));
      }}
    >
      <g aria-hidden="true">
        <rect width="800" height="405" fill="#4c617f" />
        <path d="M0 0h59v136L0 405Z" fill="#435974" />
        <path d="M800 0h-59v136l59 269Z" fill="#536783" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path
            key={i}
            d={`M${i * 9} 0v${402 - i * 40}M${800 - i * 9} 0v${402 - i * 40}`}
            stroke="#68809a"
            strokeWidth="1"
          />
        ))}
      </g>
      {things.sort((a, b) => a.depth - b.depth).map((t) => t.element)}
      {targets.map((t, i) => {
        const [x, y] = project(t.x, t.z, 0.15);
        return (
          <ellipse
            key={i}
            cx={x}
            cy={y}
            rx="12"
            ry="5"
            fill="none"
            stroke="#ffe1b0"
            strokeDasharray="4 3"
          />
        );
      })}
    </svg>
  );
}
