async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const previousId = await page.getByRole("combobox", {name: "Select experiment run"}).inputValue();
  await page.getByRole("button", {name: "Controls", exact: true}).click();
  await page.getByLabel("Experiment name", {exact: true}).fill("Journaling control validation");
  await page.getByLabel("Virtual days", {exact: false}).selectOption("2");
  await page.getByRole("combobox", {name: "Provider", exact: true}).selectOption("mock");
  await page.getByRole("checkbox", {name: /Include solo journaling/}).check();
  await page.getByRole("button", {name: /Advanced settings/}).click();
  await page.getByLabel("Event pacing (ms)", {exact: false}).fill("100");
  await page.getByRole("button", {name: "Create experiment", exact: true}).click();
  await page.waitForFunction(prior => {
    const select = document.querySelector('select[aria-label="Select experiment run"]');
    return select && select.value && select.value !== prior;
  }, previousId);
  const runId = await page.getByRole("combobox", {name: "Select experiment run"}).inputValue();
  if (await page.getByLabel("Featured department").locator("option").count() !== 3) throw new Error("Optional B office missing");
  await page.getByRole("button", {name: "Advance one day", exact: true}).click();
  let r;
  for (let attempt=0;attempt<150;attempt++) {
    r = await (await page.request.get("http://127.0.0.1:5173/api/runs/" + runId)).json();
    if (r.status === "paused" && r.state.last_completed_day === 1 && r.metrics.departments.B.journal_entries === 4 && r.metrics.departments.C.small_talk_messages === 4) break;
    await page.waitForTimeout(100);
  }
  if (r.metrics.departments.B.journal_entries !== 4 || r.metrics.departments.C.small_talk_messages !== 4) throw new Error("Condition traces differ from scheduled calls: " + JSON.stringify(r.metrics));
  await page.getByRole("tab", {name: "Conversations", exact: true}).click();
  await page.getByLabel("Filter department").selectOption("B");
  await page.getByRole("button", {name: "Journal", exact: true}).click();
  await page.getByText("Notes · Private to this agent", {exact: true}).first().waitFor();
  await page.getByRole("button", {name: "Clone run", exact: true}).click();
  await page.getByRole("heading", {name: "A fair test starts here."}).waitFor();
  await page.getByRole("button", {name: "Lab", exact: true}).last().click();
  await page.getByRole("button", {name: "Start experiment", exact: true}).click();
  await page.getByRole("button", {name: "Stop experiment", exact: true}).click();
  await page.getByRole("button", {name: "Run finished", exact: true}).waitFor();
  await page.getByRole("button", {name: "Compare", exact: true}).click();
  await page.getByRole("combobox", {name: "Parameter to compare across runs"}).selectOption("estimated_cost_usd");
  await page.screenshot({path: "output/playwright/compare.png", fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error("Compare view overflows mobile viewport");
  await page.setViewportSize({width: 1440, height: 1000});
  await page.emulateMedia({reducedMotion: "no-preference"});
  return {runId, optionalB: "rendered and private", advanceDay: "paused exactly after day one", clone: "fresh ready run", stop: "terminal", costComparison: "selected", mobileOverflow: overflow};
}
