async (page) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const base = "http://127.0.0.1:8055",
    errors = [],
    writes = [],
    screens = "output/playwright/";
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(r.method());
  });
  const btn = (name, where = page) =>
      where.getByRole("button", { name, exact: true }),
    nav = (name) => btn(name, page.getByRole("navigation")),
    label = (name) => page.getByLabel(name, { exact: true });
  const check = (v, text) => {
      if (!v) throw Error(text);
    },
    overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.locator(".stage-pet[data-pose=talking]").waitFor();
  await page.locator(".scene-scan").waitFor({ state: "hidden" });
  const startSeq = await label("Timeline replay scrubber").inputValue();
  await page.screenshot({ path: screens + "deck-desktop.png" });
  const agent = page.locator('.stage-pet[data-agent="C-verifier"]');
  await agent.hover();
  await agent.focus();
  await agent.press("Enter");
  await page.getByText("Inspect memory", { exact: true }).waitFor();
  const original = await agent.evaluate((e) => ({
    x: e.dataset.x,
    z: e.dataset.z,
  }));
  const drop = await agent.evaluate((e) => {
    const b = e.getBoundingClientRect(),
      m = e.ownerSVGElement.getScreenCTM();
    const q = new DOMPoint(
      400+(9.9-6)*(57+1.32*4.8),
      135+33.75*4.8,
    ).matrixTransform(m);
    return [b.x + b.width / 2, b.y + b.height * 0.55, q.x, q.y];
  });
  await page.mouse.move(drop[0], drop[1]);
  await page.mouse.down();
  await page.mouse.move(drop[2], drop[3], { steps: 9 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-agent="C-verifier"]').dataset.moving ===
      "true",
  );
  await page.waitForFunction(
    () =>
      Number(document.querySelector('[data-agent="C-verifier"]').dataset.x) >
      9.5,
  );
  await page.waitForFunction(
    (p) => {
      const a = document.querySelector('[data-agent="C-verifier"]');
      return (
        a.dataset.moving === "false" &&
        a.dataset.x === p.x &&
        a.dataset.z === p.z
      );
    },
    original,
    { timeout: 12000 },
  );
  check(
    (await label("Timeline replay scrubber").inputValue()) === startSeq,
    "Drag changed the replay cursor",
  );
  const scanAt = Date.now();
  await btn("Previous department").click();
  await page.locator(".department-scan .grid-scan-canvas").waitFor();
  await page.waitForTimeout(650);
  check(await page.getByRole("heading",{name:"The commons",exact:true}).count()===1,"Outgoing room disappeared before sweep");
  await page.locator(".department-scan").waitFor({state:"hidden",timeout:40000});
  check(Date.now()-scanAt>=3900,"Department scan cut short");
  await page.getByRole("heading",{name:"Reflection nook",exact:true}).waitFor();
  check(
    (await label("Featured department").inputValue()) === "B",
    "Department stepping",
  );
  await btn("Next department").click();
  await page.locator(".department-scan").waitFor({state:"hidden",timeout:40000});
  await btn("Compare all").click();
  check(
    (await page.locator(".mini-room").count()) === 3,
    "Incorrect configured arms",
  );
  await btn("Expand Department A").click();
  await page.locator(".department-scan").waitFor({state:"hidden",timeout:40000});
  await label("Featured department").selectOption("C");
  await page.locator(".department-scan").waitFor({state:"hidden",timeout:40000});
  await btn("Expand scene").click();
  await page.keyboard.press("Escape");
  check(
    (await page.locator(".viewport-card.expanded").count()) === 0,
    "Expanded scene failed to close",
  );
  await btn("3D view").click();
  const canvas = page.locator(".three-stage canvas");
  await canvas.waitFor();
  await page.locator(".scene-scan").waitFor({ state: "hidden" });
  check(
    await canvas.evaluate((c) => !!c.getContext("webgl2")),
    "Missing WebGL renderer",
  );
  async function checkCameraToolbar() {
    const map = await canvas.boundingBox();
    const control = await btn("Reset camera").boundingBox();
    check(control.y >= map.y + map.height - 1, "Camera controls cover the map");
  }
  await checkCameraToolbar();
  const area = await canvas.boundingBox();
  await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(
    area.x + area.width * 0.32,
    area.y + area.height * 0.63,
    { steps: 7 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -50);
  await page.locator(".roster button").first().click();
  await btn("Focus agent").click();
  await btn("Reset camera").click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: screens + "deck-3d.png" });
  await btn("2D view").click();
  check(
    (await label("Timeline replay scrubber").inputValue()) === startSeq,
    "2D/3D reset cursor",
  );
  await btn("Play replay", page.locator(".run-actions")).click();
  await page.waitForFunction(
    (seq) =>
      Number(
        document.querySelector('[aria-label="Timeline replay scrubber"]').value,
      ) > Number(seq),
    startSeq,
  );
  await btn("Pause replay", page.locator(".run-actions")).click();
  await btn("Return to results", page.locator(".replay-banner")).click();
  await page
    .locator('[data-agent="C-integrator"][data-pose="sleeping"]')
    .waitFor();
  await btn("Metrics", page.locator(".crew-console")).click();
  await page
    .locator(".brief-data")
    .getByText("Decision yield", { exact: true })
    .waitFor();
  await btn("Evidence", page.locator(".crew-console")).click();
  await btn("Inspect task evidence ↗").click();
  await page
    .getByRole("combobox", { name: "View from", exact: true })
    .selectOption("evaluator");
  check(
    (await page.locator(".evidence-grid td").count()) === 16,
    "Missing scorecard",
  );
  await page.getByRole("tab", { name: "Conversations" }).click();
  await btn("Small talk", page.locator(".inspector")).click();
  check(
    (await page.locator(".conversation").count()) === 4,
    "Table transcript mismatch",
  );
  await page.locator(".message-details summary").first().click();
  await page.locator(".message-details[open] pre").waitFor();
  await page.getByRole("tab", { name: "Activity" }).click();
  await label("Search recorded events").fill("hummus");
  check((await page.locator(".event-row").count()) > 0, "Log search failed");
  await page.locator(".event-row").first().click();
  await page.locator(".replay-event pre").waitFor();
  await btn("Return to results", page.locator(".replay-banner")).click();
  const readout=page.getByRole("region",{name:"Department measurements"});for(const tab of ["Usage","Channels","Outcomes"]){await btn(tab,readout).click();check(await readout.locator("tbody tr").count()===3,"Telemetry arms mismatch");}
  const metric = label("Analytics metric");
  for (const option of [
    "Optimal awards",
    "Model calls",
    "Tokens",
    "Cost per award",
    "Execution latency",
    "Conversations",
    "Evidence",
    "Decision yield",
  ]) {
    await metric.selectOption(option);
    await page
      .locator(".chart-card")
      .getByRole("heading", { name: option, exact: true })
      .waitFor();
  }
  await label("Analytics day").selectOption("1");
  await label("Network department").selectOption("B");
  await page.locator(".network-links button").first().click();
  await page.locator(".replay-banner").waitFor();
  await btn("Return to results", page.locator(".replay-banner")).click();
  await nav("Compare").click();
  await page
    .getByRole("heading", { name: "Resources and outcomes" })
    .waitFor();
  const csv = await page
    .getByRole("link", { name: "CSV", exact: true })
    .getAttribute("href");
  check(
    (await (await page.request.get(base + csv)).text()).includes(
      "decision_yield",
    ),
    "CSV missing data",
  );
  await nav("Studies").click();
  const report = await page
    .getByRole("link", { name: "Download study JSON" })
    .getAttribute("href");
  check(
    (await (await page.request.get(base + report)).json()).blocks[0].status ===
      "completed",
    "Study export failed",
  );
  await nav("History").click();
  await btn("Technical details").click();
  await btn("Read integrity audit").click();
  await page.locator(".technical>pre").waitFor();
  await btn("Clear history").click();
  await btn("Confirm clear").click();
  await page.getByRole("heading", { name: "No saved runs" }).waitFor();
  await page.reload();
  await btn("Cleared · 1").click();
  await btn("Restore all").click();
  await btn("Saved · 1").click();
  await btn("Replay from start").click();
  await btn("Pause replay", page.locator(".run-actions")).click();
  await page.locator(".replay-banner").waitFor();
  await page.reload();
  await page.locator(".stage-pet[data-pose=talking]").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".scene-scan").waitFor({ state: "hidden" });
  check(!(await overflow()), "Lab mobile overflow");
  await page.screenshot({ path: screens + "deck-mobile.png" });
  await btn("3D view").click();
  await canvas.waitFor();
  await page.locator(".scene-scan").waitFor({ state: "hidden" });
  await btn("Reset camera").click();
  await checkCameraToolbar();
  check(!(await overflow()), "3D mobile overflow");
  await page.screenshot({ path: screens + "deck-mobile-3d.png" });
  await btn("2D view").click();
  for (const dest of ["History", "Compare", "Studies"]) {
    await nav(dest).click();
    await page.waitForTimeout(160);
    check(!(await overflow()), dest + " mobile overflow");
  }
  await page.route("**/demo/api/runs.json", (r) => r.fulfill({ json: [] }));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "No recorded experiments" })
    .waitFor();
  await page.unroute("**/demo/api/runs.json");
  check(!errors.length, errors.join("\n"));
  check(!writes.length, "Hosted writes: " + writes);
  return {
    desktop: true,
    mobile: true,
    webgl: true,
    dragAndReturn: true,
    history: true,
    empty: true,
    reportedErrors: errors,
    writeRequests: writes,
  };
}
