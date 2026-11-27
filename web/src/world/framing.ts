import * as T from "three";
import type { Prop } from "./layout";

// Measure the furnished area once; the continuous wall and floor finishes extend to the view edges.
export function roomBounds(room: Prop[]) {
  const bounds = new T.Box3();
  const corner = new T.Vector3();
  for (const prop of room) {
    for (const s of prop.pieces) {
      bounds.expandByPoint(corner.set(s.x - s.w / 2, s.y, s.z - s.d / 2));
      bounds.expandByPoint(corner.set(s.x + s.w / 2, s.y + s.h, s.z + s.d / 2));
    }
  }
  return bounds;
}

export function fitWholeRoom(
  camera: T.OrthographicCamera,
  half: T.Vector3,
  aspect: number,
) {
  // The camera's right and up axes give the half-extents of the room on screen.
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  const extent = (i: number) =>
    Math.abs(m[i]) * half.x +
    Math.abs(m[i + 1]) * half.y +
    Math.abs(m[i + 2]) * half.z;
  const height = Math.max(extent(4), extent(0) / aspect) * 1.065;
  camera.left = -height * aspect;
  camera.right = height * aspect;
  camera.top = height;
  camera.bottom = -height;
  camera.updateProjectionMatrix();
}
