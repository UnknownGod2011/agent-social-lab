import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as T from "three";
import Icon from "../Icon";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneProps } from "./Room2D";
import { fitWholeRoom, roomBounds } from "./framing";
import { crew, animateCrew } from "./crew3d";
import { stations } from "./layout";
import { poseLabels, workGesture } from "../Creature";
import { dataImage } from "./art";

export default function Room3D(
  props: SceneProps & {
    toolbar: HTMLDivElement | null;
    onFallback: () => void;
    onReady: () => void;
  },
) {
  const el = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const commands = useRef<{ reset: () => void; focus: () => void } | null>(
    null,
  );
  const [error, setError] = useState(""),
    [hover, setHover] = useState("");
  useEffect(() => {
    const host = el.current!;
    let renderer: T.WebGLRenderer;
    try {
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("webgl2", {
          antialias: true,
          alpha: true,
          powerPreference: "low-power",
        });
      if (!context) throw new Error("WebGL unavailable");
      renderer = new T.WebGLRenderer({
        canvas,
        context,
        antialias: true,
        alpha: true,
      });
    } catch {
      setError("WebGL is unavailable on this device.");
      latest.current.onReady();
      return;
    }
    let alive = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    host.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "Orbitable 3D department");
    const scene = new T.Scene();
    renderer.setClearColor(0, 0);
    const camera = new T.OrthographicCamera(-10, 10, 6, -6, 0.1, 120),
      controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !latest.current.reduced;
    controls.enablePan = false;
    controls.minZoom = 0.72;
    controls.maxZoom = 4;
    controls.minAzimuthAngle = -1.15;
    controls.maxAzimuthAngle = 1.15;
    controls.maxPolarAngle = Math.PI * 0.42;
    controls.minPolarAngle = 0.12;
    const bounds = roomBounds(props.room);
    const center = bounds.getCenter(new T.Vector3());
    const half = bounds.getSize(new T.Vector3()).multiplyScalar(0.5);
    const homeOffset = new T.Vector3(13, 11, 16);
    let aspect = 1,
      lastAzimuth = NaN,
      lastPolar = NaN;
    function updateFrame() {
      const azimuth = controls.getAzimuthalAngle(),
        polar = controls.getPolarAngle();
      if (
        Math.abs(azimuth - lastAzimuth) < 0.00001 &&
        Math.abs(polar - lastPolar) < 0.00001
      )
        return;
      lastAzimuth = azimuth;
      lastPolar = polar;
      fitWholeRoom(camera, half, aspect);
    }
    const reset = () => {
      controls.target.copy(center);
      camera.position.copy(center).add(homeOffset);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
      updateFrame();
    };
    reset();
    scene.add(new T.HemisphereLight("#f0f0ff", "#898099", 2.25));
    const sun = new T.DirectionalLight("#ffdab3", 2.65);
    sun.position.set(2, 14, 9);
    sun.target.position.set(6, 0, 4);
    scene.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -11,
      right: 11,
      top: 10,
      bottom: -10,
    });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.022;
    const rim = new T.DirectionalLight("#9ebaff", 1.15);
    rim.position.set(10, 7, -5);
    scene.add(rim);
    const box = new T.BoxGeometry(),
      sphere = new T.SphereGeometry(0.5, 16, 12),
      cyl = new T.CylinderGeometry(0.5, 0.5, 1, 32);
    const batchMat = new T.MeshStandardMaterial({ roughness: 0.77 });
    const transform = new T.Object3D();
    for (const shape of ["box", "round", "leaf"] as const) {
      const solids = props.room
        .flatMap((p) => p.pieces)
        .filter((s) => s.shape === shape);
      const mesh = new T.InstancedMesh(
        shape === "box" ? box : shape === "round" ? cyl : sphere,
        batchMat,
        solids.length,
      );
      solids.forEach((s, i) => {
        transform.position.set(s.x, s.y + s.h / 2, s.z);
        transform.scale.set(s.w, s.h, s.d);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(i, new T.Color(s.color));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    for (const p of props.room) {
      if (!p.art) continue;
      const a = p.art,
        img = new Image();
      img.onload = () => {
        if (!alive) return;
        const tex = new T.Texture(img);
        tex.colorSpace = T.SRGBColorSpace;
        tex.needsUpdate = true;
        const panel = new T.Mesh(
          new T.PlaneGeometry(a.w, a.h),
          new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }),
        );
        if (a.wall === "back")
          panel.position.set(a.x + a.w / 2, a.y + a.h / 2, a.z + 0.018);
        else {
          panel.rotation.y = Math.PI / 2;
          panel.position.set(a.x + 0.018, a.y + a.h / 2, a.z - a.w / 2);
        }
        scene.add(panel);
      };
      img.src = dataImage(
        a.art.replace(
          "<svg ",
          `<svg width="${a.wall === "back" ? 800 : 380}" height="${a.wall === "back" ? 160 : 95}" `,
        ),
      );
    }
    const materials = new Map<string, T.MeshStandardMaterial>(),
      pets = props.agents.map((a, i) => {
        const pet = crew(i, materials, sphere, box);
        pet.root.userData.id = a.id;
        scene.add(pet.root);
        return pet;
      });
    const caretMaterial = new T.MeshBasicMaterial({ color: "#d1fff0" });
    const carets = stations.map((station) => {
      const caret = new T.Mesh(box, caretMaterial);
      caret.position.set(station.x, 1.38, station.z - 0.095);
      scene.add(caret);
      return caret;
    });
    const ring = new T.Mesh(
      new T.RingGeometry(0.48, 0.52, 36),
      new T.MeshBasicMaterial({ color: "#ffc39e", side: T.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    const marker = ring.clone();
    marker.scale.setScalar(0.65);
    scene.add(marker);
    const focus = () => {
      const a = latest.current,
        p = a.positions[a.selected];
      if (!p) return;
      const offset = camera.position.clone().sub(controls.target);
      controls.target.set(p.x, 0.65, p.z);
      camera.position.copy(controls.target).add(offset);
      camera.zoom = 1.75;
      camera.updateProjectionMatrix();
      controls.update();
    };
    let tween: { pos: T.Vector3; target: T.Vector3; zoom: number } | null =
      null;
    function transition(fn: () => void) {
      if (latest.current.reduced) {
        fn();
        return;
      }
      const pos = camera.position.clone(),
        target = controls.target.clone(),
        zoom = camera.zoom;
      fn();
      tween = {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        zoom: camera.zoom,
      };
      camera.position.copy(pos);
      controls.target.copy(target);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    commands.current = {
      reset: () => transition(reset),
      focus: () => transition(focus),
    };
    const observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      aspect = width / height;
      lastAzimuth = NaN;
      updateFrame();
      renderer.setSize(width, height, false);
    });
    observer.observe(host);
    const ray = new T.Raycaster(),
      pointer = new T.Vector2(),
      plane = new T.Plane(new T.Vector3(0, 1, 0), -0.09);
    function cast(e: PointerEvent) {
      const b = canvas.getBoundingClientRect();
      pointer.set(
        (2 * (e.clientX - b.left)) / b.width - 1,
        1 - (2 * (e.clientY - b.top)) / b.height,
      );
      ray.setFromCamera(pointer, camera);
    }
    function hit() {
      let o: T.Object3D | null =
        ray.intersectObjects(
          pets.map((p) => p.root),
          true,
        )[0]?.object ?? null;
      while (o && !o.userData.id) o = o.parent;
      return props.agents.find((a) => a.id === o?.userData.id);
    }
    let gesture: { a: AgentRef; x: number; y: number } | null = null;
    type AgentRef = (typeof props.agents)[number];
    function down(e: PointerEvent) {
      tween = null;
      cast(e);
      const a = hit();
      if (a && e.button === 0) {
        gesture = { a, x: e.clientX, y: e.clientY };
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      }
    }
    function up(e: PointerEvent) {
      if (gesture) {
        const g = gesture;
        gesture = null;
        controls.enabled = true;
        latest.current.onPick(g.a);
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) {
          cast(e);
          const v = new T.Vector3();
          if (ray.ray.intersectPlane(plane, v))
            latest.current.onMove(g.a.id, { x: v.x, z: v.z });
        }
      }
    }
    function cancel() {
      gesture = null;
      controls.enabled = true;
      setHover("");
    }
    function over(e: PointerEvent) {
      if (gesture) return;
      cast(e);
      const a = hit();
      const label = a
        ? `${a.name} · ${a.role} · ${poseLabels[latest.current.poses[a.id]?.pose ?? "idle"]} · Dept. ${a.id.split("-")[0]}`
        : "";
      setHover(label);
      canvas.style.cursor = a ? "grab" : "move";
    }
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointerup", up, true);
    canvas.addEventListener("pointermove", over);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("pointerleave", () => setHover(""));
    const lost = (e: Event) => {
      e.preventDefault();
      setError("The graphics context was interrupted.");
    };
    canvas.addEventListener("webglcontextlost", lost);
    let frame = 0,
      ready = false;
    function draw(now: number) {
      const p = latest.current;
      frame = requestAnimationFrame(draw);
      if (!p.active) return;
      const t = p.reduced ? 0 : now / 1000;
      ring.visible = false;
      marker.visible = false;
      pets.forEach((pet, i) => {
        const a = p.agents[i],
          pos = p.positions[a.id];
        if (!pos) return;
        const station = stations[i],
          caret = carets[i];
        const gesture = workGesture(p.poses[a.id]?.pose ?? "idle", i);
        caret.visible =
          !!gesture &&
          a.location === "desk" &&
          !pos.moving &&
          Math.hypot(pos.x - station.x, pos.z - station.z - 1.02) < 0.3;
        if (caret.visible) {
          const cycle = p.reduced ? 0.5 : (t * 0.65 + i * 0.3) % 1;
          caret.position.x = station.x - 0.35 + cycle * 0.5;
          caret.position.y = 1.35 + Math.floor(cycle * 3) * 0.08;
          caret.scale.set(
            gesture === "review" ? 0.19 : 0.034,
            gesture === "review" ? 0.025 : 0.08,
            0.012,
          );
        }
        animateCrew(
          pet,
          i,
          pos,
          p.poses[a.id]?.pose ?? "idle",
          t,
          p.phase === "break" && a.location === "table",
          p.reduced,
        );
        if (a.id === p.selected) {
          ring.position.set(pos.x, 0.145, pos.z);
          ring.visible = true;
        }
        if (pos.target) {
          marker.position.set(pos.target.x, 0.15, pos.target.z);
          marker.visible = true;
        }
      });
      if (tween) {
        camera.position.lerp(tween.pos, 0.18);
        controls.target.lerp(tween.target, 0.18);
        camera.zoom += (tween.zoom - camera.zoom) * 0.18;
        camera.updateProjectionMatrix();
        if (
          Math.abs(tween.zoom - camera.zoom) < 0.001 &&
          controls.target.distanceTo(tween.target) < 0.005 &&
          camera.position.distanceTo(tween.pos) < 0.005
        )
          tween = null;
      }
      controls.update();
      updateFrame();
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        p.onReady();
      }
    }
    frame = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener("webglcontextlost", lost);
      commands.current = null;
      const geometries = new Set<T.BufferGeometry>(),
        mats = new Set<T.Material>();
      scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          geometries.add(o.geometry);
          for (const m of [o.material].flat()) mats.add(m);
          if (o instanceof T.InstancedMesh) o.dispose();
        }
      });
      geometries.forEach((g) => g.dispose());
      mats.forEach((m) => {
        if ("map" in m && m.map instanceof T.Texture) m.map.dispose();
        m.dispose();
      });
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [props.room]);
  return (
    <div className="three-stage" ref={el}>
      {error ? (
        <div className="graphics-error">
          <strong>{error}</strong>
          <button onClick={props.onFallback}>Open 2D room</button>
        </div>
      ) : (
        <>
          {props.toolbar &&
            createPortal(
              <>
                <button
                  title="Show the whole room"
                  aria-label="Reset camera"
                  onClick={() => commands.current?.reset()}
                >
                  <Icon name="reset" size={14} />
                  <span>Whole room</span>
                </button>
                <button
                  aria-label="Focus agent"
                  disabled={!props.selected}
                  title={
                    props.selected
                      ? "Frame selected crew member"
                      : "Select a crew member first"
                  }
                  onClick={() => commands.current?.focus()}
                >
                  <Icon name="focus" size={14} />
                  <span>Focus</span>
                </button>
              </>,
              props.toolbar,
            )}
          {hover && <span className="mesh-tooltip">{hover}</span>}
        </>
      )}
    </div>
  );
}
