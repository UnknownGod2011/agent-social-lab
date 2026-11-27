async (page) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("http://127.0.0.1:8055/");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-agent="C-verifier"]').waitFor();
  const start = await page.getByLabel("Timeline replay scrubber").inputValue(),
    b = (name) => page.getByRole("button", { name, exact: true });
  await b("3D view").click();
  const canvas = page.locator(".three-stage canvas");
  await canvas.waitFor();
  await page.locator(".scene-scan").waitFor({ state: "hidden" });
  const rect = await canvas.boundingBox();
  // Pick Nori through the real mesh. The hit target can shift with breathing and framing.
  let hit = null;
  for (const v of [0.55, 0.5, 0.6, 0.45, 0.65]) {
    for (const u of [0.68, 0.66, 0.7, 0.64, 0.72]) {
      const x = rect.x + rect.width * u, y = rect.y + rect.height * v;
      await page.mouse.move(x, y);
      if ((await page.locator(".mesh-tooltip").allTextContents()).some(t => t.includes("Nori"))) {
        hit = {x, y};
        break;
      }
    }
    if (hit) break;
  }
  if (!hit) throw Error("Nori mesh could not be picked in the whole-room view");
  const tx = hit.x + rect.width * 0.07, ty = hit.y + rect.height * 0.18;
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 9 });
  await page.mouse.up();
  await page.getByText("Inspect memory", { exact: true }).waitFor();
  await b("2D view").click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector('[data-agent="C-verifier"]').dataset.x) >
      9.25,
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-agent="C-verifier"]').dataset.x ===
        "8.85" &&
      document.querySelector('[data-agent="C-verifier"]').dataset.moving ===
        "false",
  );
  if (
    (await page.getByLabel("Timeline replay scrubber").inputValue()) !== start
  )
    throw Error("3D drag changed research cursor");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (name, ...args) {
      return name.startsWith("webgl")
        ? null
        : original.call(this, name, ...args);
    };
  });
  await b("3D view").click();
  await b("Open 2D room").click();
  await page.locator(".stage-pet").first().waitFor();
  const animation = await page
    .locator(".stage-pet .pet-torso")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  if (animation !== "none") throw Error("Reduced motion ignored");
  return {
    raycastHover: true,
    dragFrom3D: true,
    continuedIn2D: true,
    returnToStation: true,
    unsupportedWebGLFallback: true,
    reducedMotion: true,
  };
}
