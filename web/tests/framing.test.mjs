import test from "node:test";
import assert from "node:assert/strict";
import { OrthographicCamera, Vector3, MathUtils } from "three";
import { buildRoom } from "../src/world/layout.ts";
import { fitWholeRoom, roomBounds } from "../src/world/framing.ts";

test("the entire modeled room fits at home zoom across departments, camera angles and aspect ratios", () => {
  for (const arm of ["A", "B", "C"]) {
    const bounds = roomBounds(buildRoom(arm, "#b6b1ba", "", ""));
    const center = bounds.getCenter(new Vector3());
    const half = bounds.getSize(new Vector3()).multiplyScalar(0.5);
    for (const aspect of [0.8, 1.6, 2, 2.4]) {
      for (const yaw of [-55, 10, 55]) {
        for (const polar of [20, 60, 74]) {
          const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
          camera.position
            .setFromSphericalCoords(
              20,
              MathUtils.degToRad(polar),
              MathUtils.degToRad(yaw),
            )
            .add(center);
          camera.lookAt(center);
          fitWholeRoom(camera, half, aspect);
          let outermost = 0;
          for (const x of [bounds.min.x, bounds.max.x]) {
            for (const y of [bounds.min.y, bounds.max.y]) {
              for (const z of [bounds.min.z, bounds.max.z]) {
                const p = new Vector3(x, y, z).project(camera);
                assert.ok(Math.abs(p.z) <= 1);
                outermost = Math.max(outermost, Math.abs(p.x), Math.abs(p.y));
              }
            }
          }
          // Keep the model large enough to read, with visible clearance at its tightest edge.
          assert.ok(outermost > 0.9 && outermost < 0.96);
          camera.zoom = 1.75;
          fitWholeRoom(camera, half, aspect / 2);
          assert.equal(camera.zoom, 1.75);
        }
      }
    }
  }
});
