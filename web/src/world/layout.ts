import type { Agent, Arm } from "../types";

export type Point = { x: number; z: number };
export type Solid = Point & {
  y: number;
  w: number;
  h: number;
  d: number;
  color: string;
  shape: "box" | "round" | "leaf";
  glow?: boolean;
};
export type Illustration = {
  wall: "back" | "left";
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  art: string;
};
export type Prop = Point & {
  pieces: Solid[];
  art?: Illustration;
  radius?: [number, number];
  base?: boolean;
  finish?: "floor" | "wall";
};
export const WIDTH = 12,
  DEPTH = 8;
export const viewBox = "0 0 800 405";
export const project = (x: number, z: number, h = 0) => [
  400 + (x - 6) * (57 + 1.32 * z),
  135 + 33.75 * z - (47 + z * 0.8) * h,
];
export function unproject(u: number, v: number): Point {
  const z = (v - 135) / 33.75;
  return { x: 6 + (u - 400) / (57 + 1.32 * z), z };
}
export const stations = [
  { x: 2.5, z: 0.94 },
  { x: 6.3, z: 0.94 },
  { x: 1.35, z: 3.55 },
  { x: 3.6, z: 5.05 },
];
export const cabins = [3.8, 5.8, 7.8, 9.8].map((x) => ({ x, z: 7.4 }));
export const lounge = { x: 7.5, z: 4.05 };
export function destination(a: Agent, i: number): Point {
  if (/bed|home/.test(a.location) || a.activity === "sleeping")
    return { ...cabins[i] };
  if (a.location === "table")
    return [
      { x: 6.22, z: 3.65 },
      { x: 7.63, z: 2.47 },
      { x: 8.85, z: 4.05 },
      { x: 7.35, z: 5.27 },
    ][i];
  if (/quiet|journal|break|rest/.test(a.location))
    return { x: 3.4 + i * 1.65, z: 5.7 };
  const s = stations[i];
  return { x: s.x, z: s.z + 1.02 };
}
export function buildRoom(
  arm: Arm,
  accent: string,
  windowArt: string,
  signArt: string,
) {
  const props: Prop[] = [];
  function item(x: number, z: number, radius?: [number, number], base = false) {
    const prop: Prop = { x, z, pieces: [], radius, base };
    props.push(prop);
    function add(
      shape: Solid["shape"],
      dx: number,
      y: number,
      dz: number,
      w: number,
      h: number,
      d: number,
      color: string,
      glow = false,
    ) {
      prop.pieces.push({
        shape,
        x: x + dx,
        z: z + dz,
        y,
        w,
        h,
        d,
        color,
        glow,
      });
    }
    return {
      prop,
      box: add.bind(null, "box"),
      round: add.bind(null, "round"),
      leaf: add.bind(null, "leaf"),
    };
  }
  const f = item(6, 4, undefined, true);
  f.prop.finish = "floor";
  f.box(0, -0.47, 0, 12.3, 0.45, 8.3, "#263753");
  f.box(0, -0.14, 0, 12.16, 0.13, 8.16, "#88a5b3");
  f.box(0, -0.04, 0, 12.12, 0.1, 8.12, "#506682");
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 8; j++) {
      const tint = ["#536783", "#596f88", "#566b87", "#526780"][
        (i * 7 + j * 11) % 4
      ];
      f.box(i - 5.5, 0.055, j - 3.5, 0.987, 0.009, 0.985, tint);
    }
  for (let i = 0; i < 12; i += 1.5)
    f.box(
      i - 5.35,
      -0.29,
      4.12,
      0.64,
      0.038,
      0.03,
      i % 3 === 0 ? accent : "#59718b",
      true,
    );
  const back = item(6, -0.13, undefined, true);
  back.prop.finish = "wall";
  back.box(0, 0, 0, 12.32, 2.85, 0.25, "#4c617f");
  back.box(0, 2.84, 0, 12.35, 0.12, 0.35, "#96a7bc");
  back.box(0, 0.25, 0.15, 12.2, 0.12, 0.14, "#8fa4b8");
  back.box(0, 2.64, 0.15, 12.2, 0.04, 0.08, "#c1e6e5", true);
  const left = item(-0.14, 4, undefined, true);
  left.prop.finish = "wall";
  left.box(0, 0, 0, 0.27, 2.86, 8.25, "#3c5571");
  left.box(0, 2.84, 0, 0.37, 0.12, 8.35, "#9aafba");
  left.box(0.16, 0.25, 0, 0.13, 0.12, 8.14, "#8fa4b8");
  for (let j = 1; j < 8; j += 2)
    left.box(0.14, 0.48, j - 4, 0.055, 2.12, 0.08, "#647d97");
  const win = item(4.55, 0.14, undefined, true);
  win.box(0, 1.04, 0, 7.63, 1.55, 0.12, "#1d2c48");
  win.prop.art = {
    wall: "back",
    x: 0.82,
    z: 0.22,
    y: 1.12,
    w: 7.45,
    h: 1.4,
    art: windowArt,
  };
  win.box(0, 1, 0.12, 7.75, 0.09, 0.24, "#a4afbf");
  for (const x of [-1.87, 1.87])
    win.box(x, 1.09, 0.14, 0.065, 1.47, 0.045, "#607894");
  const sign = item(10.15, 0.14, undefined, true);
  sign.box(0, 1.99, 0, 3.15, 0.79, 0.14, "#25334b");
  sign.prop.art = {
    wall: "back",
    x: 8.67,
    z: 0.225,
    y: 2.06,
    w: 2.96,
    h: 0.64,
    art: signArt,
  };
  const duct = item(0, 6.28, undefined, true);
  duct.box(0.16, 1.27, 0, 0.14, 1, 1.7, "#334965");
  for (let i = 0; i < 6; i++)
    duct.box(0.255, 1.39 + i * 0.12, 0, 0.085, 0.041, 1.39, "#93a9b9");
  duct.box(0.27, 2.54, 0, 0.095, 0.065, 1.76, "#efbd92", true);
  const rack = item(10.08, 0.32, [1.05, 0.45]);
  rack.box(0, 0, 0, 2.12, 1.92, 0.65, "#31415a");
  rack.box(0, 1.91, 0, 2.24, 0.1, 0.75, "#aec4cd");
  for (let j = 0; j < 3; j++) {
    rack.box(0, j * 0.54 + 0.22, 0.035, 2, 0.07, 0.69, "#7c8c9f");
    for (let i = 0; i < 7; i++)
      rack.box(
        -0.79 + i * 0.25,
        j * 0.54 + 0.29,
        0.16,
        0.15,
        0.23 + (i % 3) * 0.07,
        0.42,
        ["#99bdb9", "#e49a74", "#9789ae", "#e9c377", "#688ca5"][(i + j) % 5],
      );
  }
  function plant(x: number, z: number, k: number) {
    const p = item(x, z, [0.3 * k, 0.3 * k]);
    p.round(0, 0.07, 0, 0.65 * k, 0.48 * k, 0.65 * k, "#de947d");
    p.round(0, 0.48 * k, 0, 0.73 * k, 0.13 * k, 0.73 * k, "#f3b398");
    for (let i = 0; i < 8; i++) {
      const t = i * 2.4;
      p.leaf(
        Math.cos(t) * 0.2 * k,
        0.52 * k,
        Math.sin(t) * 0.21 * k,
        0.24 * k,
        (0.65 + (i % 3) * 0.24) * k,
        0.31 * k,
        ["#429a98", "#8dd1ad", "#66b99d"][i % 3],
      );
    }
  }
  plant(11.55, 0.75, 1.15);
  plant(0.54, 7.54, 0.95);
  plant(0.45, 0.5, 0.85);
  stations.forEach((s, i) => {
    const p = item(s.x, s.z, [0.99, 0.5]),
      box = p.box;
    const l = ["#fcaa7c", "#8cddce", "#c0a8ff", "#ef9ca1"][i];
    for (const side of [-0.77, 0.77])
      box(side, 0.08, 0, 0.17, 0.7, 0.84, "#324159");
    box(0, 0.74, 0, 2.03, 0.16, 1.04, "#b2b9b5");
    box(0, 0.89, 0, 2.09, 0.065, 1.08, "#dfcfb7");
    box(0, 0.955, -0.17, 0.48, 0.055, 0.24, "#536477");
    box(0, 1, -0.2, 0.09, 0.18, 0.09, "#69788a");
    box(0, 1.14, -0.22, 1.24, 0.68, 0.12, "#29384f");
    box(0, 1.19, -0.144, 1.12, 0.55, 0.032, "#2e5470");
    for (let n = 0; n < 4; n++)
      box(
        -0.34 + (n % 2) * 0.07,
        1.58 - n * 0.085,
        -0.119,
        0.26 + n * 0.08,
        0.019,
        0.013,
        n === 1 ? "#f5bc96" : "#a3e7d9",
        true,
      );
    box(0.33, 1.25, -0.117, 0.24, 0.25, 0.017, l, true);
    box(-0.05, 0.96, 0.24, 0.71, 0.035, 0.24, "#647385");
    for (let k = 0; k < 5; k++)
      box(-0.29 + k * 0.12, 0.999, 0.24, 0.07, 0.012, 0.14, "#adc4ce");
    box(0.57, 0.96, 0.22, 0.17, 0.16, 0.17, l);
    // Each desk keeps one personal object and an independently lit reading lamp.
    box(-0.77, 0.96, -0.18, 0.25, 0.05, 0.23, "#4d5b73");
    box(-0.78, 1.01, -0.18, 0.045, 0.4, 0.045, "#a5aabc");
    box(-0.67, 1.39, -0.18, 0.28, 0.05, 0.045, "#a5aabc");
    box(-0.55, 1.38, -0.18, 0.23, 0.09, 0.2, l);
    box(-0.55, 1.365, -0.18, 0.2, 0.018, 0.17, "#ffe2b0", true);
    box(
      0.73,
      0.96,
      -0.07,
      0.26,
      0.035,
      0.24,
      ["#edb293", "#96b9c4", "#c0aacd", "#8bc2a9"][i],
    );
    box(0.73, 1.0, -0.07, 0.24, 0.018, 0.22, "#e3d8bc");
    const chair = item(s.x, s.z + 0.73);
    chair.round(0, 0.06, 0, 0.57, 0.07, 0.57, "#344961");
    chair.round(0, 0.13, 0, 0.11, 0.24, 0.11, "#95a1ac");
    chair.box(0, 0.37, 0, 0.54, 0.15, 0.51, "#708aaa");
    chair.box(0, 0.48, 0.23, 0.55, 0.39, 0.11, "#7f99b2");
  });
  cabins.forEach((s, i) => {
    const b = item(s.x, s.z, [0.72, 0.39]);
    b.box(0, 0.06, 0, 1.47, 0.24, 0.84, "#3a4c67");
    b.box(0, 0.29, 0, 1.46, 0.135, 0.83, "#93a3bc");
    b.box(
      0.23,
      0.425,
      0,
      0.89,
      0.075,
      0.79,
      ["#6897ab", "#709fa0", "#968bb2", "#b88783"][i],
    );
    b.box(-0.46, 0.426, 0, 0.37, 0.12, 0.62, "#cdd0cb");
  });
  const rug = item(lounge.x, lounge.z, undefined, true);
  rug.round(
    0,
    0.07,
    0,
    4,
    0.045,
    3.7,
    arm === "B" ? "#807395" : arm === "C" ? "#9c796e" : "#557e90",
  );
  rug.round(0, 0.116, 0, 3.84, 0.009, 3.54, "#575e77");
  if (arm === "C") {
    const t = item(lounge.x, lounge.z, [0.85, 0.7]);
    t.round(0, 0.13, 0, 0.83, 0.12, 0.71, "#435069");
    t.round(0, 0.25, 0, 0.31, 0.4, 0.29, "#b48b76");
    t.round(0, 0.65, 0, 1.86, 0.16, 1.52, "#b08272");
    t.round(0, 0.81, 0, 1.88, 0.06, 1.54, "#e7b591");
    t.round(-0.39, 0.87, 0.08, 0.14, 0.15, 0.14, "#8dced1");
    t.round(0.31, 0.87, -0.06, 0.16, 0.17, 0.16, "#ee8368");
    t.box(0.02, 0.87, 0.24, 0.34, 0.03, 0.24, "#faf0d8");
  } else {
    const o = item(lounge.x, lounge.z, [0.7, 0.53]);
    o.box(0, 0.12, 0, 1.42, 0.62, 1.09, "#596e8d");
    o.box(0, 0.74, 0, 1.48, 0.1, 1.12, arm === "B" ? "#b6a6cb" : "#91c2cf");
    o.box(0, 0.84, 0, 0.8, 0.055, 0.5, arm === "B" ? "#f0d7bb" : "#394d68");
    if (arm === "B") o.box(0, 0.9, 0, 0.027, 0.01, 0.49, "#a78e83");
  }
  const cabinet = item(11.36, 2.19, [0.48, 0.42]);
  cabinet.box(0, 0.08, 0, 0.9, 0.86, 0.72, "#526680");
  cabinet.box(0, 0.93, 0, 0.97, 0.09, 0.76, "#a8b4bc");
  for (const h of [0.35, 0.69]) {
    cabinet.box(0, h, 0.37, 0.75, 0.22, 0.025, "#72899f");
    cabinet.box(0, h + 0.1, 0.402, 0.24, 0.033, 0.035, "#cad0ce");
  }
  cabinet.round(0, 1.02, -0.02, 0.48, 0.06, 0.46, "#485b72");
  cabinet.round(0, 1.08, -0.02, 0.3, 0.4, 0.3, "#88c4c7");
  cabinet.round(0, 1.47, -0.02, 0.32, 0.055, 0.32, "#bfcccd");
  return props;
}
export function walkPath(start: Point, goal: Point, props: Prop[]): Point[] {
  const step = 0.25,
    nx = 47,
    nz = 31;
  const cells = Array.from({ length: nx * nz }, (_, i) => ({
    x: 0.25 + (i % nx) * step,
    z: 0.25 + Math.floor(i / nx) * step,
  }));
  const blocks = props.filter((p) => p.radius);
  const open = cells.map(
    (q) =>
      !blocks.some(
        (p) =>
          Math.abs(p.x - q.x) < p.radius![0] + 0.14 &&
          Math.abs(p.z - q.z) < p.radius![1] + 0.14,
      ),
  );
  function nearest(q: Point) {
    let best = -1,
      dist = Infinity;
    cells.forEach((c, i) => {
      const d = (c.x - q.x) ** 2 + (c.z - q.z) ** 2;
      if (open[i] && d < dist) {
        best = i;
        dist = d;
      }
    });
    return best;
  }
  const first = nearest(start),
    last = nearest(goal);
  if (first < 0 || last < 0) return [];
  const prev = new Int32Array(cells.length).fill(-1),
    queue = [first];
  prev[first] = first;
  for (let k = 0; k < queue.length && prev[last] === -1; k++) {
    const i = queue[k];
    for (const j of [i - 1, i + 1, i - nx, i + nx]) {
      if (
        !open[j] ||
        prev[j] !== -1 ||
        Math.abs(cells[i].x - cells[j].x) > 0.26
      )
        continue;
      prev[j] = i;
      queue.push(j);
    }
  }
  if (prev[last] === -1) return [];
  const path: Point[] = [];
  for (let n = last; n !== first; n = prev[n]) path.push(cells[n]);
  return path.reverse();
}
