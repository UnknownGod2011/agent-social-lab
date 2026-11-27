import * as T from "three";
import { COLORS } from "../types";
import type { Walker } from "./motion";
import { workGesture, type Pose } from "../Creature";
export function crew(
  i: number,
  materials: Map<string, T.MeshStandardMaterial>,
  sphere: T.SphereGeometry,
  box: T.BoxGeometry,
) {
  const feet: T.Mesh[] = [];
  const lids: T.Mesh[] = [];
  const ears: { mesh: T.Object3D; angle: number }[] = [];
  const paws: T.Mesh[] = [];
  const root = new T.Group(),
    body = new T.Group(),
    head = new T.Group(),
    eyes = new T.Group(),
    arms = new T.Group();
  function part(
    parent: T.Object3D,
    c: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    square = false,
  ) {
    if (!materials.has(c))
      materials.set(
        c,
        new T.MeshStandardMaterial({ color: c, roughness: 0.8 }),
      );
    const mesh = new T.Mesh(square ? box : sphere, materials.get(c));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const c = COLORS[i],
    ink = "#3b3449",
    cream = "#ffdfb1";
  root.add(body);
  body.add(head, arms);
  head.add(eyes);
  part(body, c, 0, 0.4, 0, 0.76, 0.75, 0.62);
  part(head, c, 0, 0.88, 0, 1, 0.85, 0.76);
  part(
    body,
    ["#da8260", "#548a90", "#79629d", "#af677a"][i],
    0,
    0.38,
    0,
    0.83,
    0.41,
    0.65,
  );
  part(body, cream, 0, 0.39, 0.28, 0.46, 0.22, 0.1);
  for (const s of [-1, 1]) {
    feet.push(part(body, ink, s * 0.23, 0.12, 0.03, 0.28, 0.2, 0.35));
    paws.push(part(arms, c, s * 0.42, 0.43, 0.13, 0.24, 0.38, 0.22));
    part(head, "#fff0d8", s * 0.18, 0.92, 0.332, 0.149, 0.166, 0.086);
    part(eyes, ink, s * 0.18, 0.92, 0.372, 0.105, 0.14, 0.072);
    const lid = part(head, c, s * 0.18, 0.975, 0.376, 0.155, 0.032, 0.086);
    lids.push(lid);
    const brow = part(
      head,
      ["#995d48", "#548b83", "#766085", "#98596a"][i],
      s * 0.18,
      1.035,
      0.327,
      0.155,
      0.027,
      0.04,
    );
    brow.rotation.z = s * 0.13;
    part(eyes, "#fff4da", s * 0.18 + 0.016, 0.946, 0.408, 0.028, 0.032, 0.02);
    part(head, "#de9296", s * 0.315, 0.805, 0.29, 0.14, 0.06, 0.08);
    if (i === 0 || i === 2) {
      const ear = part(
        head,
        c,
        s * 0.3,
        1.28,
        0,
        i === 0 ? 0.22 : 0.21,
        i === 0 ? 0.46 : 0.63,
        0.2,
      );
      ear.rotation.z = -s * 0.25;
      const inner = part(
        head,
        "#eda5ac",
        s * 0.32,
        1.34,
        0.083,
        0.085,
        i === 0 ? 0.23 : 0.33,
        0.053,
      );
      inner.rotation.z = -s * 0.25;
      ears.push(
        { mesh: ear, angle: ear.rotation.z },
        { mesh: inner, angle: inner.rotation.z },
      );
    }
    if (i === 1) part(head, c, s * 0.45, 1.02, 0, 0.23, 0.25, 0.24);
    if (i === 2) {
      const rim = new T.Mesh(
        new T.TorusGeometry(0.138, 0.018, 6, 24),
        materials.get(ink),
      );
      rim.position.set(s * 0.18, 0.92, 0.386);
      head.add(rim);
    }
    if (i === 3) {
      const fin = part(head, "#ed91a0", s * 0.45, 0.89, 0, 0.33, 0.23, 0.13);
      fin.rotation.z = s * 0.45;
      const leaf = part(head, "#99cd9d", s * 0.1, 1.4, 0, 0.18, 0.34, 0.13);
      leaf.rotation.z = -s * 0.62;
      ears.push(
        { mesh: fin, angle: fin.rotation.z },
        { mesh: leaf, angle: leaf.rotation.z },
      );
    }
  }
  // Muzzles, helmet seams and asymmetric equipment keep the four silhouettes legible in profile.
  for (const side of [-1, 1]) {
    part(
      head,
      ["#ffe2b5", "#a9dfca", "#d9c9e9", "#ffd1c3"][i],
      side * 0.081,
      0.815,
      0.354,
      0.185,
      0.125,
      0.104,
    );
    if (i === 1)
      part(head, "#ffdb8f", side * 0.16, 1.31, 0.03, 0.054, 0.3, 0.59);
  }
  part(head, ink, 0, 0.85, 0.415, 0.083, 0.057, 0.054);
  const mouth = part(head, ink, 0, 0.77, 0.392, 0.081, 0.026, 0.041);
  if (i === 2) part(head, ink, 0, 0.934, 0.388, 0.117, 0.021, 0.028, true);
  const tail = part(
    body,
    c,
    i === 0 ? -0.37 : 0,
    0.43,
    -0.31,
    i === 0 ? 0.29 : 0.23,
    i === 0 || i === 3 ? 0.63 : 0.24,
    0.26,
  );
  tail.rotation.z = 0.48;
  if (i === 0) part(tail, cream, -0.035, 0.31, 0, 0.85, 0.34, 0.9);
  const pad = new T.Group();
  body.add(pad);
  pad.position.set(0, 0.76, 0.53);
  part(pad, "#475468", 0, 0, 0, 0.45, 0.056, 0.43, true);
  part(
    pad,
    i === 2 ? "#9ce0d5" : "#f4dfbd",
    0,
    0.035,
    0,
    0.383,
    0.016,
    0.35,
    true,
  );
  for (let k = 0; k < 3; k++)
    part(
      pad,
      "#729196",
      -0.015,
      0.046,
      -0.1 + 0.082 * k,
      0.25,
      0.006,
      0.016,
      true,
    );
  const pencil = new T.Group();
  part(pencil, "#ffc378", 0, 0.112, 0, 0.036, 0.27, 0.036, true);
  part(pencil, ink, 0, -0.035, 0, 0.022, 0.038, 0.022);
  body.add(pencil);
  if (i === 1) {
    part(head, "#f7b45f", 0, 1.26, 0, 0.86, 0.38, 0.68);
    part(head, "#ffcf80", 0, 1.18, 0.08, 0.99, 0.1, 0.81);
  }
  if (i === 0) {
    part(body, "#ed7f6b", 0, 0.56, 0.24, 0.58, 0.13, 0.28);
  }
  // Pivot the head at the neck rather than rotating all facial features around the feet.
  for (const child of head.children) child.position.y -= 0.64;
  head.position.y = 0.64;
  return {
    root,
    body,
    head,
    eyes,
    arms,
    feet,
    paws,
    lids,
    ears,
    mouth,
    tail,
    pad,
    pencil,
  };
}

export function animateCrew(
  pet: ReturnType<typeof crew>,
  i: number,
  pos: Walker,
  pose: Pose,
  t: number,
  atTable: boolean,
  reduced: boolean,
) {
  const moving = pos.moving;
  const asleep = !moving && pose === "sleeping";
  const social =
    !moving && (pose === "talking" || pose === "asking" || pose === "helping");
  const gesture = moving || atTable ? undefined : workGesture(pose, i);
  const work = Boolean(gesture),
    inspecting = gesture === "review",
    typing = gesture === "type",
    writing = gesture === "write";
  const tick = reduced ? 0 : t;
  const beat = (frequency: number, phase = 0) =>
    reduced ? 0 : Math.sin(tick * frequency + i * 0.91 + phase);
  const stride = beat(10);
  const glance = reduced || asleep ? 0 : Math.pow(Math.max(0, beat(0.88)), 3);
  const blinkPhase = (tick + i * 0.98) % (4.4 + i * 0.31);
  const lid = asleep
    ? 1
    : reduced
      ? 0
      : Math.max(0, 1 - Math.abs(blinkPhase - 0.16) / 0.12);
  pet.root.position.set(pos.x, 0.13, pos.z);
  const targetAngle = moving
    ? (pos.heading ?? 0)
    : atTable
      ? Math.atan2(7.5 - pos.x, 4.05 - pos.z)
      : work
        ? (i % 2 ? -1 : 1) * (Math.PI - (inspecting ? 1.38 : 1.04))
        : 0.25;
  pet.root.rotation.y +=
    Math.atan2(
      Math.sin(targetAngle - pet.root.rotation.y),
      Math.cos(targetAngle - pet.root.rotation.y),
    ) * (reduced ? 1 : 0.17);

  pet.body.position.y = asleep
    ? 0.4
    : work
      ? 0.09 + beat(2.3) * 0.018
      : moving
        ? Math.abs(stride) * 0.075
        : beat(1.85) * 0.019;
  pet.body.rotation.set(
    asleep ? -0.89 : typing ? 0.14 : work ? 0.055 : 0,
    0,
    moving ? stride * 0.05 : asleep ? 0.08 : 0,
  );
  pet.body.scale.y = asleep ? 0.83 : work ? 0.95 : 1;
  pet.head.rotation.set(
    asleep
      ? 0.15
      : work
        ? 0.16 - glance * 0.28 + beat(inspecting ? 2.1 : 3.2) * 0.042
        : beat(1.65) * 0.033,
    asleep
      ? 0
      : (i % 2 ? 1 : -1) * glance * (work ? 0.95 : 0.47) +
          (inspecting ? beat(2.1) * 0.2 : 0),
    asleep
      ? 0.09
      : (social ? beat(4.1) * 0.06 : beat(0.96) * 0.04) - glance * 0.095,
  );
  pet.eyes.position.x = asleep ? 0 : beat(1.15) * 0.013 + glance * 0.023;
  pet.eyes.position.y = -0.64 + (work ? -0.009 : 0);
  for (const eyelid of pet.lids) {
    eyelid.scale.y = 0.032 + lid * 0.132;
    eyelid.position.y = 0.975 - 0.64 - lid * 0.052;
    eyelid.position.z = 0.376 + lid * 0.04;
  }
  pet.eyes.visible = !asleep && lid < 0.8;
  pet.mouth.scale.y = social ? 0.045 + (beat(8) * 0.5 + 0.5) * 0.06 : 0.026;
  pet.ears.forEach(({ mesh, angle }, n) => {
    mesh.rotation.z =
      angle +
      (asleep ? 0.08 : glance * 0.14 + beat(2.4, n < 2 ? 0 : 1.4) * 0.035);
  });
  pet.tail.rotation.z = 0.48 + beat(moving ? 8 : 2.8) * (asleep ? 0.025 : 0.14);
  pet.pad.visible = writing || inspecting;
  pet.pad.rotation.set(
    inspecting ? -0.85 + beat(2.2) * 0.09 : -0.23,
    0,
    beat(1.5) * 0.025,
  );
  pet.pencil.visible = writing;
  pet.pencil.position.set(
    0.14 + beat(6) * 0.07,
    0.83 + beat(9) * 0.024,
    0.53 + beat(3.8) * 0.09,
  );
  pet.pencil.rotation.z = -0.41;
  pet.feet.forEach((foot, n) => {
    const step = n ? -stride : stride;
    foot.position.set(
      (n ? 1 : -1) * 0.23,
      0.12 + (moving ? 0.13 * Math.max(0, step) : 0),
      0.03 + (moving ? 0.18 * step : work ? 0.12 : 0),
    );
    foot.rotation.x = moving ? step * 0.45 : 0;
  });
  pet.paws.forEach((paw, n) => {
    const tap = beat(9.7, n * Math.PI);
    const side = n ? 1 : -1;
    if (work) {
      paw.position.set(
        side * (typing ? 0.254 : 0.213) + (writing && n ? beat(6) * 0.072 : 0),
        typing
          ? 0.71 + tap * 0.102
          : (inspecting ? 0.78 : 0.73) + beat(4.4, n) * 0.035,
        typing ? 0.49 + tap * 0.065 : 0.5,
      );
      paw.rotation.set(-0.97 + (typing ? tap * 0.35 : 0), 0, side * -0.25);
    } else {
      paw.position.set(side * 0.42, 0.43 + (social && n ? 0.16 : 0), 0.14);
      paw.rotation.set(
        moving
          ? tap * 0.62
          : asleep
            ? -0.4
            : social && n
              ? -0.62 + beat(3) * 0.23
              : 0,
        0,
        social && n ? 0.57 + beat(3.1) * 0.19 : 0,
      );
    }
  });
}
