async (page) => {
  const base = "http://127.0.0.1:8055";
  const errors = [],
    writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.method());
  });
  const btn = (name, where = page) =>
    where.getByRole("button", { name, exact: true });
  const assert = (ok, why) => {
    if (!ok) throw Error(why);
  };
  const box = (locator) => locator.boundingBox();
  const theme = () => page.locator("html").getAttribute("data-theme");
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const screen = (name) =>
    page.screenshot({ path: "output/playwright/" + name + ".png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await page.goto(base);
  await page.evaluate(() => localStorage.removeItem("btt-theme"));
  await page.reload();
  await btn("Compare all").waitFor();
  await page.locator(".tech-heading canvas").waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert(
    (await theme()) === "dark",
    "fresh workspace did not start in dark mode",
  );
  await btn("Switch to light mode").click();
  assert((await theme()) === "light", "dark to light");
  assert(
    await page
      .locator(".room-vector")
      .first()
      .evaluate((e) => getComputedStyle(e).filter === "none"),
    "room art was desaturated",
  );
  const cursor = page.getByLabel("Timeline replay scrubber");
  const seq = await cursor.inputValue();
  const originalWidth = (await box(page.locator(".viewport-card"))).width;
  const original = await page
    .locator(".team-readout tbody tr")
    .evaluateAll((rs) => rs.map((r) => r.querySelector("td").textContent));
  await screen("neutral-lab-light");
  await btn("Compare all").click();
  await page
    .locator(".inspector-dust i")
    .first()
    .waitFor({ state: "attached" });
  await page.locator(".crew-console").waitFor({ state: "hidden" });
  await page.waitForTimeout(750);
  assert(
    await page.locator(".inspector-slot").evaluate((e) => e.inert),
    "hidden inspector can receive keyboard input",
  );
  const widths = await page
    .locator(".board-room-link")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().width));
  assert(
    widths.length === 3 && Math.min(...widths) > 300,
    "compressed desktop rooms " + widths,
  );
  assert(
    (await box(page.locator(".viewport-card"))).width > originalWidth + 250,
    "sidebar width not reclaimed",
  );
  const board = page.locator(".department-board");
  assert(
    JSON.stringify(
      await board.locator(".principal-measure td").allTextContents(),
    ) === JSON.stringify(original),
    "readouts disagree",
  );
  await btn("Usage", board).click();
  assert(
    (await board.innerText()).includes("Synthetic calls") &&
      (await board.innerText()).includes("Offline"),
    "mock billing lost",
  );
  await btn("Channels", board).click();
  assert((await board.innerText()).includes("Journal"), "channel lens missing");
  await btn("Outcomes", board).click();
  await board.locator("summary").first().click();
  await board.getByRole("button", { name: /View event #/ }).waitFor();
  await board.locator("summary").first().click();
  await screen("neutral-compare-light");
  await btn("Switch to blue mode").click();
  assert((await theme()) === "blue", "light to classic blue");
  assert(
    await page
      .locator(".viewport-card")
      .evaluate(
        (e) => getComputedStyle(e).backgroundColor === "rgb(27, 36, 53)",
      ),
    "original viewport color changed",
  );
  await screen("classic-compare");
  await btn("Switch to dark mode").click();
  assert((await theme()) === "dark", "dark toggle failed");
  assert(
    (await cursor.inputValue()) === seq,
    "theme or comparison changed time",
  );
  await screen("neutral-compare-dark");
  await page.reload();
  await btn("Switch to light mode").waitFor();
  assert((await theme()) === "dark", "saved preference lost");
  await btn("Compare all").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(850);
  assert(!(await overflow()), "mobile body overflow");
  const bounds = await board.locator(".board-room-link").evaluateAll((es) =>
    es.map((e) => ({
      top: e.getBoundingClientRect().top,
      width: e.getBoundingClientRect().width,
    })),
  );
  assert(
    Math.max(...bounds.map((b) => b.top)) -
      Math.min(...bounds.map((b) => b.top)) <
      2,
    "mobile columns misaligned",
  );
  assert(
    await page.locator(".crew-console").isHidden(),
    "mobile inspector still occupies comparison area",
  );
  await screen("neutral-compare-mobile");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await btn("Featured room").click();
  await btn("Compare all").click();
  assert(
    !(await page.locator(".inspector-dust").count()),
    "particles with reduced motion",
  );
  await btn("Expand Department A").click();
  assert(
    (await page.getByLabel("Featured department").inputValue()) === "A",
    "selected arm lost",
  );
  assert((await cursor.inputValue()) === seq, "selection changed time");
  await btn("Switch to light mode").click();
  await btn("Compare", page.getByRole("navigation")).click();
  await page.locator(".compare-page").waitFor();
  assert(!(await overflow()), "compare charts overflow");
  assert(!errors.length && !writes.length, JSON.stringify({ errors, writes }));
  return { widths, bounds, seq, errors, writes };
}
