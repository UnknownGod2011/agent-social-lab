import * as T from "three";

// Continuous architectural finishes reach all four edges as the camera rotates.
// The cutaway plinth used in the plan view has no exposed edges in this interior.
export function roomInterior() {
  const interior = new T.Group();
  function panels(wall: boolean) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    const g = tile.getContext("2d")!;
    g.fillStyle = wall ? "#435a74" : "#4c607b";
    g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        const x = col * 128,
          y = row * 128;
        g.fillStyle = (
          wall
            ? ["#506782", "#526a86", "#4f6681", "#506984"]
            : ["#536783", "#596f88", "#566b87", "#526780"]
        )[row * 2 + col];
        g.fillRect(x + 1, y + 1, 126, 126);
        if (wall) {
          g.fillStyle = "#71849a";
          g.fillRect(x + 3, y + 3, 122, 1);
          g.fillStyle = "#3e536d";
          g.fillRect(x + 8, y + 8, 2, 2);
        }
      }
    const map = new T.CanvasTexture(tile);
    map.colorSpace = T.SRGBColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping;
    return map;
  }
  const surface = (w: number, h: number, tileSize: number, wall: boolean) => {
    const map = panels(wall);
    map.repeat.set(w / tileSize, h / tileSize);
    const m = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshStandardMaterial({ map, roughness: 0.93 }),
    );
    m.receiveShadow = true;
    interior.add(m);
    return m;
  };
  const floor = surface(180, 180, 2, false);
  floor.position.set(6, 0.056, 4);
  floor.rotation.x = -Math.PI / 2;
  const back = surface(180, 64, 4, true);
  back.position.set(6, 32, -0.02);
  for (const [x, angle] of [
    [-0.025, Math.PI / 2],
    [12.6, -Math.PI / 2],
  ]) {
    const side = surface(180, 64, 4, true);
    side.position.set(x, 32, 4);
    side.rotation.y = angle;
  }
  const edge = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ) => {
    const mesh = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshStandardMaterial({ color }),
    );
    mesh.position.set(x, y, z);
    interior.add(mesh);
  };
  for (const [y, h, color] of [
    [0.23, 0.12, "#738ba1"],
    [2.71, 0.1, "#354961"],
    [2.7, 0.032, "#c0dcd9"],
  ] as const) {
    const thick = h === 0.032 ? 0.065 : 0.043;
    edge(150, h, thick, 6, y, 0, color);
    edge(thick, h, 150, -0.01, y, 4, color);
  }
  return interior;
}
