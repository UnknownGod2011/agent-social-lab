async (page) => {
  const problems = [],
    writes = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.method());
  });
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const orb = button("About local researcher workspace");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const gpu = WebGL2RenderingContext.prototype;
    const draw = gpu.drawArrays,
      clear = gpu.clear;
    const sample = (window.waterSample = {
      peak: 0,
      colored: 0,
      finished: false,
      frames: 0,
    });
    gpu.drawArrays = function (...args) {
      const result = draw.apply(this, args);
      if (
        !this.canvas.classList.contains("splash-cursor__canvas") ||
        this.getParameter(this.FRAMEBUFFER_BINDING) ||
        !window.measureWater
      )
        return result;
      sample.frames++;
      const pixels = new Uint8Array(96 * 64 * 4);
      const px = Math.floor(this.drawingBufferWidth * 0.5);
      const py = Math.floor(this.drawingBufferHeight * 0.5);
      this.readPixels(
        px - 48,
        py - 32,
        96,
        64,
        this.RGBA,
        this.UNSIGNED_BYTE,
        pixels,
      );
      for (let i = 0; i < pixels.length; i += 4) {
        sample.peak = Math.max(sample.peak, pixels[i + 3]);
        if (
          pixels[i + 3] > 4 &&
          Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
            Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
            1
        )
          sample.colored++;
      }
      return result;
    };
    gpu.clear = function (...args) {
      const result = clear.apply(this, args);
      if (
        this.canvas.classList.contains("splash-cursor__canvas") &&
        !this.getParameter(this.FRAMEBUFFER_BINDING) &&
        sample.peak > 0 &&
        window.measureWater
      ) {
        const pixel = new Uint8Array(4);
        this.readPixels(
          this.drawingBufferWidth >> 1,
          this.drawingBufferHeight >> 1,
          1,
          1,
          this.RGBA,
          this.UNSIGNED_BYTE,
          pixel,
        );
        sample.finished = pixel[3] === 0;
      }
      return result;
    };
  });
  await page.goto("http://127.0.0.1:8055");
  await page.evaluate(() => localStorage.removeItem("btt-theme"));
  await page.reload();
  await page.locator(".camera-time").waitFor();
  const roomSize = await page.locator(".camera-frame").boundingBox(),
    viewSize = await page.locator(".viewport-body").boundingBox();
  check(
    Math.abs(roomSize.height - viewSize.height) < 3,
    "The 2D room leaves an empty strip",
  );
  const cursor = page.getByLabel("Timeline replay scrubber"),
    seq = await cursor.inputValue();
  check(
    !(await page.locator(".camera-tag").count()),
    "floor plan badge is present",
  );
  await page.locator(".soft-aurora__canvas").waitFor();
  await page.locator(".workspace-strands canvas").waitFor();
  await page.locator(".water-trail canvas").waitFor();
  const bounds = await orb.boundingBox();
  check(bounds.width <= 38 && bounds.height <= 38, "orb exceeds avatar slot");
  const before = await orb.screenshot();
  await orb.hover();
  await page.waitForTimeout(660);
  check(!before.equals(await orb.screenshot()), "orb shader is static");
  const strand = page.locator(".workspace-strands canvas");
  const last = await strand.screenshot();
  await page.waitForTimeout(520);
  check(!last.equals(await strand.screenshot()), "background did not animate");
  await orb.click();
  await page.getByRole("dialog").waitFor();
  await button("Close about dialog").click();
  await page.evaluate(() => {
    window.measureWater = true;
  });
  await page.mouse.move(545, 400);
  await page.mouse.move(640, 400, { steps: 10 });
  await page.mouse.click(640, 400);
  await page.waitForFunction(
    () => window.waterSample.peak > 0 && window.waterSample.colored > 0,
  );
  await page.waitForFunction(() => window.waterSample.finished);
  const water = await page.evaluate(() => {
    window.measureWater = false;
    return window.waterSample;
  });
  check(
    (await cursor.inputValue()) === seq,
    "appearance changed the research cursor",
  );
  await page.screenshot({ path: "output/playwright/aurora-workspace.png" });
  await button("Switch to light mode").click();
  await orb.focus();
  await orb.press("Enter");
  await page.getByRole("dialog").waitFor();
  await button("Close about dialog").click();
  await button("Switch to blue mode").click();
  await button("3D view").click();
  await page.locator(".three-stage canvas").waitFor();
  await page.locator(".scene-loading").waitFor({ state: "hidden" });
  check(
    await page
      .locator(".three-stage canvas")
      .evaluate((c) => !!c.getContext("webgl2")),
    "3D unavailable with effects",
  );
  await button("2D view").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await orb.waitFor();
  check(await orb.isVisible(), "mobile avatar lost");
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
    "mobile overflow",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".soft-aurora__canvas").waitFor({ state: "detached" });
  check(
    !(await page.locator(".water-trail,.workspace-strands").count()),
    "reduced motion retained animated surfaces",
  );
  await orb.click();
  await page.getByRole("dialog").waitFor();
  const mobile = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
  try {
    await mobile.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (name, ...args) {
        return name.startsWith("webgl")
          ? null
          : getContext.call(this, name, ...args);
      };
    });
    const touch = await mobile.newPage();
    touch.on("pageerror", (e) => problems.push(e.message));
    await touch.goto("http://127.0.0.1:8055");
    await touch.locator(".camera-time").waitFor();
    check(
      !(await touch.locator(".water-trail").count()),
      "touch-only device loaded the cursor",
    );
    await touch
      .getByRole("button", { name: "About local researcher workspace" })
      .tap();
    await touch.getByRole("dialog").waitFor();
  } finally {
    await mobile.close();
  }
  check(
    !problems.length && !writes.length,
    JSON.stringify({ problems, writes }),
  );
  return {
    orbWidth: bounds.width,
    water,
    desktop: true,
    mobile: true,
    reduced: true,
    webglRoom: true,
    problems,
    writes,
  };
}
