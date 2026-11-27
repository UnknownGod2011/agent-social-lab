import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Agent } from "../types";
import { destination, walkPath, type Point, type Prop } from "./layout";
export type Walker = Point & {
  moving: boolean;
  facing: number;
  heading?: number;
  target?: Point;
};
export function useWalkers(
  agents: Agent[],
  room: Prop[],
  active: boolean,
  phase: string,
  reduced: boolean,
  rewind: number,
) {
  const initial = () =>
    Object.fromEntries(
      agents.map((a, i) => [
        a.id,
        { ...destination(a, i), moving: false, facing: 1 },
      ]),
    ) as Record<string, Walker>;
  const [positions, setPositions] = useState(initial);
  const current = useRef(positions),
    paths = useRef(new Map<string, Point[]>()),
    request = useRef(0),
    locations = useRef<Record<string, string>>({});
  const prevSeq = useRef(rewind);
  const returns = useRef(new Map<string, { point: Point; after: number }>());
  const route = useCallback(
    (id: string, goal: Point, station = false) => {
      const p = current.current[id];
      if (!p) return;
      const path = walkPath(p, goal, room);
      if (station) path.push(goal);
      if (reduced) {
        const end = path.at(-1) ?? p;
        current.current = {
          ...current.current,
          [id]: { ...end, moving: false, facing: p.facing },
        };
        paths.current.delete(id);
        setPositions(current.current);
        return;
      }
      paths.current.set(id, path);
      current.current = {
        ...current.current,
        [id]: { ...p, target: path.at(-1) },
      };
      setPositions(current.current);
    },
    [room, reduced],
  );
  const move = useCallback(
    (id: string, goal: Point) => {
      const i = agents.findIndex((a) => a.id === id);
      if (i < 0) return;
      const home = destination(agents[i], i);
      returns.current.set(id, { point: home, after: 0 });
      route(id, goal);
    },
    [agents, route],
  );
  const targets = agents.map((a) => a.id + "/" + a.location).join("|");
  useLayoutEffect(() => {
    if (prevSeq.current > rewind) {
      paths.current.clear();
      returns.current.clear();
      current.current = initial();
      setPositions(current.current);
      locations.current = {};
    }
    prevSeq.current = rewind;
    agents.forEach((a, i) => {
      const key = phase + "/" + a.location;
      if (locations.current[a.id] && locations.current[a.id] !== key) {
        returns.current.delete(a.id);
        route(a.id, destination(a, i), true);
      }
      locations.current[a.id] = key;
    });
  }, [targets, phase, rewind, route]);
  const walking = paths.current.size > 0 || returns.current.size > 0;
  useEffect(() => {
    if (!active || !walking) return;
    let last = performance.now();
    function tick(t: number) {
      const dt = Math.min((t - last) / 1000, 0.06);
      last = t;
      const next = { ...current.current };
      let more = false;
      for (const [id, path] of paths.current) {
        let travel = dt * 3.9,
          p = { ...next[id] };
        while (path.length && travel > 0) {
          const to = path[0],
            dx = to.x - p.x,
            dz = to.z - p.z,
            d = Math.hypot(dx, dz);
          if (d > 0.001) p.heading = Math.atan2(dx, dz);
          if (Math.abs(dx - dz) > 0.01) p.facing = dx - dz < 0 ? -1 : 1;
          if (d <= travel) {
            p = { ...p, ...to };
            travel -= d;
            path.shift();
          } else {
            p.x += (dx / d) * travel;
            p.z += (dz / d) * travel;
            travel = 0;
          }
        }
        p.moving = path.length > 0;
        if (!p.moving) {
          p.target = undefined;
          paths.current.delete(id);
        } else more = true;
        next[id] = p;
      }
      for (const [id, back] of returns.current) {
        if (paths.current.has(id)) continue;
        if (back.after === 0) back.after = t + 850;
        if (t >= back.after) {
          returns.current.delete(id);
          if (reduced) {
            next[id] = {
              ...back.point,
              moving: false,
              facing: next[id].facing,
            };
          } else {
            const path = walkPath(next[id], back.point, room);
            if (
              path.length ||
              Math.hypot(next[id].x - back.point.x, next[id].z - back.point.z) >
                0.01
            ) {
              path.push(back.point);
              paths.current.set(id, path);
              next[id] = { ...next[id], target: path.at(-1) };
              more = true;
            }
          }
        } else more = true;
      }
      current.current = next;
      setPositions(next);
      if (more) request.current = requestAnimationFrame(tick);
    }
    request.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request.current);
  }, [active, walking, room, reduced]);
  return { positions, move };
}
export function useVisibility<T extends HTMLElement>() {
  const ref = useRef<T>(null),
    [active, setActive] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = true;
    const update = () => setActive(visible && !document.hidden);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return { ref, active };
}
export function useReducedMotion() {
  const [value, set] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => set(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return value;
}
