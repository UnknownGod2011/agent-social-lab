async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:5173",
    real = "http://127.0.0.1:8000";
  const btn = (name, where = page) =>
      where.getByRole("button", { name, exact: true }),
    nav = (n) => btn(n, page.getByRole("navigation")),
    label = (n) => page.getByLabel(n, { exact: true }),
    check = (v, m) => {
      if (!v) throw Error(m);
    };
  // The mutation test is restricted to a disposable mock-only QA database on port 5173.
  const r = await page.request.post(base + "/api/runs", {
    data: {
      name: "UI integration check",
      provider: "mock",
      model: "mock-v1",
      environment: "supplier_selection_v1",
      arms: ["A", "B", "C"],
      days: 1,
      tick_ms: 80,
      work_rounds: 2,
    },
  });
  check(r.ok(), "QA run creation failed");
  const original = await r.json();
  await page.goto(base);
  await label("Select experiment run").selectOption(original.id);
  await btn("Start experiment").click();
  await btn("Pause").click();
  await btn("Resume").click();
  await btn("Run finished").waitFor({ timeout: 60000 });
  const detail = await (
    await page.request.get(base + "/api/runs/" + original.id)
  ).json();
  check(detail.status === "completed", "Run did not complete");
  await nav("History").click();
  await label("Search history").fill(original.id);
  await btn("Technical details").click();
  await btn("Read integrity audit").click();
  await page.locator(".technical>pre").waitFor();
  await btn("Restart as new run").click();
  await btn("Start experiment").waitFor();
  const fresh = await label("Select experiment run").inputValue();
  check(fresh !== original.id, "Restart reused old run");
  const copied = await (
    await page.request.get(base + "/api/runs/" + fresh)
  ).json();
  check(
    copied.config_hash === original.config_hash && copied.status === "ready",
    "Restart changed config",
  );
  await page.reload();
  check(
    (await label("Select experiment run").inputValue()) === fresh,
    "Selected run lost after refresh",
  );
  await nav("Compare").click();
  await label("Parameter to compare across runs").selectOption(
    "estimated_cost_usd",
  );
  await nav("Controls").click();
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("deepseek");
  await label("Model ID").waitFor();
  // Original research DB is opened in read-only UI flows and uses existing provider records.
  const runs = await (await page.request.get(real + "/api/runs")).json();
  const live = runs.find(
    (r) =>
      r.config.provider === "deepseek" &&
      r.status === "completed" &&
      r.config.environment === "supplier_selection_v1",
  );
  check(live, "Expected historical calibration record");
  const before = (
    await (await page.request.get(real + "/api/runs/" + live.id)).json()
  ).seq;
  await page.goto(real);
  await label("Select experiment run").selectOption(live.id);
  await page.getByText("LIVE MODEL RUN", { exact: true }).waitFor();
  await label("Analytics metric").selectOption("Execution latency");
  await page.locator(".distribution rect:not([height='0'])").first().waitFor();
  await page.locator("#analysis").scrollIntoViewIfNeeded();
  await page
    .locator("#analysis")
    .screenshot({ path: "output/playwright/deck-analysis-private.png" });
  await nav("Compare").click();
  await label("Parameter to compare across runs").selectOption("total_tokens");
  await nav("Studies").click();
  await page.getByRole("link", { name: "Download study JSON" }).waitFor();
  check(
    (await (await page.request.get(real + "/api/runs/" + live.id)).json())
      .seq === before,
    "Read-only inspection mutated calibration",
  );
  check(!errors.length, errors.join("\n"));
  return {
    isolatedStartPauseResume: true,
    restart: true,
    selectionPersists: true,
    recordedModel: live.config.provider,
    originalSeq: before,
    reportedErrors: errors,
  };
}
