async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:5173/#studies");
  await page.reload();
  await page.getByRole("button", { name: "Register a study" }).click();
  await page.getByLabel("Study title").fill("Offline instrument check");
  await page.getByLabel("Starting case seed").fill("90017");
  await page.getByLabel("Matched blocks").fill("1");
  await page.getByLabel("Virtual days").fill("1");
  await page.getByLabel("Rounds per work block").fill("2");
  await page
    .getByRole("button", { name: "Freeze protocol and allocate blocks" })
    .click();
  await page.locator(".registry-form").waitFor({ state: "hidden" });
  await page
    .getByRole("row")
    .filter({ hasText: "90017" })
    .getByRole("button", { name: "Open block" })
    .click();
  const selector = page.getByRole("combobox", {
    name: "Select experiment run",
  });
  await page.getByLabel("Featured department").waitFor();
  const id = await selector.inputValue();
  const request = async () =>
    (await page.request.get("http://127.0.0.1:5173/api/runs/" + id)).json();
  if ((await request()).status === "ready")
    await page
      .getByRole("button", { name: "Start experiment", exact: true })
      .click();
  for (let i = 0; i < 600 && (await request()).status !== "completed"; i++)
    await page.waitForTimeout(300);
  const run = await request();
  if (
    run.status !== "completed" ||
    run.metrics.departments.A.optimal_decisions !== 1
  )
    throw Error("Mock block incomplete or incorrectly scored");
  await page.locator(".network-links button").first().click();
  await page.locator(".replay-banner").waitFor();
  await page
    .locator(".replay-banner")
    .getByRole("button", { name: "Return to live" })
    .click();
  await page.locator(".room-vector").first().waitFor();
  await page.getByRole("tab", { name: "Goals", exact: true }).click();
  await page.getByLabel("View from").selectOption("evaluator");
  if ((await page.locator(".evidence-grid td").count()) !== 16)
    throw Error("Missing scorer evidence");
  await page.screenshot({
    path: "output/playwright/research-office.png",
    fullPage: false,
  });
  const messages = await (
    await page.request.get(`http://127.0.0.1:5173/api/runs/${id}/events?event_type=message_sent&channel=small_talk`)
  ).json();
  const speech = messages.at(-1);
  if (!speech) throw Error("Missing social turn");
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.getByRole("textbox", { name: "Search recorded events" }).fill(speech.payload_json.text);
  await page.locator(`.event-row[title^="Inspect event ${speech.seq} "]`).click();
  await page.locator('[data-agent^="C-"][data-pose="talking"]').waitFor();
  await page.screenshot({ path: "output/playwright/research-break.png", fullPage: false });
  await page.locator(".replay-banner").getByRole("button", { name: "Return to live" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Resources and outcomes" })
    .waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Controls", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("deepseek");
  if (
    !(await page
      .getByRole("textbox", { name: "Model ID", exact: true })
      .inputValue()
      .then((v) => v === "deepseek-flash"))
  )
    throw Error("Incorrect DeepSeek model default");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Studies", exact: true })
    .click();
  await page.getByRole("link", { name: "Download study JSON" }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download study JSON" }).click();
  const exported = (await download).suggestedFilename();
  await page.screenshot({
    path: "output/playwright/study-registry.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const overflow = async () =>
    page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (await overflow()) throw Error("Mobile registry overflows");
  await page.screenshot({
    path: "output/playwright/study-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Register a study" }).click();
  if (await overflow()) throw Error("Mobile registration overflows");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Lab", exact: true })
    .click();
  if (await overflow()) throw Error("Mobile office overflows");
  const motion = await page.locator(".stage-pet .pet-torso").first()
    .evaluate(el => getComputedStyle(el).animationName);
  if (motion !== "none") throw Error("Office animations ignore reduced motion");
  if (errors.length) throw Error(errors.join(", "));
  return {
    id,
    exported,
    errors,
    mobileOverflow: false,
    events: run.seq,
    yield: run.metrics.departments.C.decision_yield,
  };
}
