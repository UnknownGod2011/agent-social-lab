import { useState } from "react";
import type { Config, Run } from "./types";
import { DEFAULT_CONFIG, ROLES, money, nice, num } from "./types";
import { api } from "./api";
import Icon from "./Icon";

type Preview = {
  logical_calls?: number;
  max_attempts?: number;
  upper_bound_tokens?: number;
  estimated_cost_usd?: number | null;
  [key: string]: unknown;
};
export default function Experiment({
  run,
  onCreate,
  busy,
  health,
}: {
  run: Run | null;
  onCreate: (config: Config) => Promise<void>;
  busy: boolean;
  health: Record<string, unknown> | null;
}) {
  const [config, setConfig] = useState<Config>({
    ...DEFAULT_CONFIG,
    ...run?.config,
    role_prompts: { ...run?.config.role_prompts },
    paid_confirmed: false,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [providerCheck, setProviderCheck] = useState<string | null>(null);
  const update = <K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setPreview(null);
    if (key === "provider" || key === "model") setProviderCheck(null);
  };
  const providers = health?.providers as
    Record<string, Record<string, unknown>> | undefined;
  const keys = providers?.gemini?.configured_keys;
  async function estimate() {
    setPreviewBusy(true);
    setError("");
    try {
      setPreview(await api<Preview>("/preview", config));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPreviewBusy(false);
    }
  }
  async function check() {
    setProviderCheck("Checking provider connection…");
    try {
      const result = await api<Record<string, unknown>>("/providers/check", {
        model: config.model,
      });
      setProviderCheck(JSON.stringify(result, null, 2));
    } catch (e) {
      setProviderCheck(String(e instanceof Error ? e.message : e));
    }
  }
  return (
    <div className="experiment-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DESIGN THE COMPARISON</span>
          <h2>A fair test starts here.</h2>
          <p>
            The same goal, roles and work allowance. One deliberately different
            break.
          </p>
        </div>
        <span className="badge muted">
          <Icon name="link" size={13} /> Config freezes at start
        </span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onCreate(config);
          } catch (e) {
            setError(String(e instanceof Error ? e.message : e));
          }
        }}
      >
        <div className="settings-grid">
          <section className="panel settings-panel">
            <div className="section-heading">
              <span className="step-number">01</span>
              <div>
                <h3>Experiment setup</h3>
                <p>A miniature task-board project, across several days.</p>
              </div>
            </div>
            <label className="field full">
              Experiment name
              <input
                required
                maxLength={100}
                value={config.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <div className="field-grid">
              <label className="field">
                Virtual days
                <select
                  value={config.days}
                  onChange={(e) => update("days", Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "day" : "days"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Random seed
                <input
                  type="number"
                  min="0"
                  max="2147483647"
                  required
                  value={config.seed}
                  onChange={(e) => update("seed", Number(e.target.value))}
                />
              </label>
            </div>
            <div className="field">
              <span>Experimental conditions</span>
              <div className="condition-option fixed">
                <span className="arm-tag">A</span>
                <div>
                  <strong>Work only</strong>
                  <p>Work messages, then silent rest at each break.</p>
                </div>
                <Icon name="check" size={16} />
              </div>
              <div className="condition-option fixed">
                <span className="arm-tag social">C</span>
                <div>
                  <strong>Work + small talk</strong>
                  <p>The same work allowance, plus bounded table chat.</p>
                </div>
                <Icon name="check" size={16} />
              </div>
              <label className="condition-option optional">
                <input
                  type="checkbox"
                  checked={config.arms.includes("B")}
                  onChange={(e) =>
                    update(
                      "arms",
                      e.target.checked ? ["A", "B", "C"] : ["A", "C"],
                    )
                  }
                />
                <span className="arm-tag journal">B</span>
                <div>
                  <strong>Include solo journaling</strong>
                  <p>
                    Private non-task reflection to control extra model calls.
                  </p>
                </div>
              </label>
            </div>
            <div className="inline-note">
              <Icon name="info" size={15} />
              <span>
                All departments receive identical initial task state and role
                templates. Initial-state hashes are recorded.
              </span>
            </div>
          </section>
          <section className="panel settings-panel">
            <div className="section-heading">
              <span className="step-number">02</span>
              <div>
                <h3>Model & budget</h3>
                <p>Everything happens on the server. Keys stay there.</p>
              </div>
            </div>
            <label className="field">
              Provider
              <select
                value={config.provider}
                onChange={(e) => update("provider", e.target.value)}
              >
                <option value="mock">Mock · deterministic offline demo</option>
                <option value="gemini">Gemini · live model</option>
                <option value="openai">OpenAI compatible · live model</option>
              </select>
            </label>
            {config.provider !== "mock" && (
              <>
                <label className="field">
                  Model ID
                  <input
                    required
                    value={config.model}
                    onChange={(e) => update("model", e.target.value)}
                  />
                </label>
                <div className="provider-status">
                  <Icon name="key" size={16} />
                  <div>
                    <strong>
                      {config.provider === "gemini"
                        ? `${typeof keys === "number" ? keys : "—"} keys configured in server pool`
                        : "Server-side credentials"}
                    </strong>
                    <p>
                      Bounded retries, cooldown and rotation. Shared project
                      limits still apply.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={check}
                    disabled={config.provider !== "gemini"}
                    title={
                      config.provider !== "gemini"
                        ? "Connection preflight is available for Gemini only; configure the OpenAI-compatible adapter server-side."
                        : "Check the selected Gemini model and configured credential pool"
                    }
                  >
                    {config.provider === "gemini"
                      ? "Check"
                      : "Gemini check only"}
                  </button>
                </div>
                {providerCheck && (
                  <pre className="provider-check">{providerCheck}</pre>
                )}
              </>
            )}
            {config.provider === "mock" && (
              <div className="mock-explainer">
                <Icon name="flask" size={23} />
                <div>
                  <strong>No keys. No charges. Fully reproducible.</strong>
                  <p>
                    Synthetic agents illustrate the workflow. Mock outcomes are
                    never evidence for a research hypothesis.
                  </p>
                </div>
              </div>
            )}
            <div className="field-grid">
              <label className="field">
                Maximum API attempts
                <input
                  type="number"
                  min="1"
                  max="100000"
                  required
                  value={config.max_calls}
                  onChange={(e) => update("max_calls", Number(e.target.value))}
                />
              </label>
              <label className="field">
                Token cap
                <input
                  type="number"
                  min="1"
                  max="100000000"
                  required
                  value={config.max_tokens}
                  onChange={(e) => update("max_tokens", Number(e.target.value))}
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                USD spending cap
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  required
                  value={config.max_cost_usd}
                  onChange={(e) =>
                    update("max_cost_usd", Number(e.target.value))
                  }
                />
              </label>
              <label className="field">
                Output tokens / call
                <input
                  type="number"
                  min="64"
                  max="8192"
                  required
                  value={config.max_output_tokens}
                  onChange={(e) =>
                    update("max_output_tokens", Number(e.target.value))
                  }
                />
              </label>
            </div>
            {config.provider !== "mock" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.paid_confirmed}
                  onChange={(e) => update("paid_confirmed", e.target.checked)}
                />
                <span>
                  Explicitly allow paid model usage up to the configured USD
                  cap.
                  <small>
                    Free-tier project designated by researcher; provider billing
                    is not verified. Paid use requires confirmation.
                  </small>
                </span>
              </label>
            )}
            <button
              type="button"
              className="button secondary estimate-button"
              onClick={estimate}
              disabled={previewBusy}
            >
              <Icon name="chart" size={15} />
              {previewBusy ? "Estimating…" : "Preview maximum usage"}
            </button>
            {preview && (
              <>
                <div className="preview-grid">
                  <div>
                    <small>Logical calls</small>
                    <strong>{num(preview.logical_calls)}</strong>
                  </div>
                  <div>
                    <small>With retries</small>
                    <strong>{num(preview.max_attempts)}</strong>
                  </div>
                  <div>
                    <small>Upper token bound</small>
                    <strong>{num(preview.upper_bound_tokens)}</strong>
                  </div>
                  <div>
                    <small>USD ceiling</small>
                    <strong>{money(preview.estimated_cost_usd)}</strong>
                  </div>
                </div>
                <p className="help-text" style={{ marginTop: 10 }}>
                  {String(
                    preview.note ??
                      "Configured hard ceilings, not predicted or provider-confirmed charges.",
                  )}
                </p>
              </>
            )}
          </section>
        </div>
        <section className="panel advanced-panel">
          <button
            type="button"
            className="advanced-heading"
            onClick={() => setAdvanced(!advanced)}
            aria-expanded={advanced}
          >
            <div>
              <Icon name="settings" size={18} />
              <span>
                <strong>Advanced settings</strong>
                <small>
                  Schedule, turn limits, role prompts and presentation speed
                </small>
              </span>
            </div>
            <span>
              {advanced ? "Hide" : "Customize"}{" "}
              <Icon name="chevron" size={14} />
            </span>
          </button>
          {advanced && (
            <div className="advanced-body">
              <div className="field-grid four">
                <label className="field">
                  Schedule mode
                  <select
                    value={config.scheduler_mode}
                    onChange={(e) => update("scheduler_mode", e.target.value)}
                  >
                    <option value="virtual">Virtual time · accelerated</option>
                    <option value="calendar">Calendar time · daily wake</option>
                  </select>
                </label>
                <label className="field">
                  Work rounds / block
                  <input
                    type="number"
                    min="1"
                    max="12"
                    required
                    value={config.work_rounds}
                    onChange={(e) =>
                      update("work_rounds", Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Break every N days
                  <input
                    type="number"
                    min="1"
                    max="5"
                    required
                    value={config.talk_frequency}
                    onChange={(e) =>
                      update("talk_frequency", Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Break length (virtual min)
                  <input
                    type="number"
                    min="5"
                    max="120"
                    required
                    value={config.break_length}
                    onChange={(e) =>
                      update("break_length", Number(e.target.value))
                    }
                  />
                </label>
              </div>
              {config.scheduler_mode === "calendar" && (
                <>
                  <div className="field-grid">
                    <label className="field">
                      Daily local wake time
                      <input
                        type="time"
                        required
                        value={config.wake_time}
                        onChange={(e) => update("wake_time", e.target.value)}
                      />
                    </label>
                    <label className="field">
                      IANA time zone
                      <input
                        required
                        value={config.timezone}
                        onChange={(e) => update("timezone", e.target.value)}
                        placeholder="Asia/Kolkata"
                      />
                    </label>
                  </div>
                  <div className="inline-note">
                    <Icon name="clock" size={15} />
                    <span>
                      The local backend must remain running and the computer
                      awake. Due times persist across restarts; missed days
                      resume once, without duplicate starts.
                    </span>
                  </div>
                </>
              )}
              <label className="field">
                Event pacing (ms)
                <input
                  type="number"
                  min="0"
                  max="10000"
                  required
                  value={config.tick_ms}
                  onChange={(e) => update("tick_ms", Number(e.target.value))}
                />
                <small>
                  Presentation delay between engine steps. It is not model
                  latency or a work allowance.
                </small>
              </label>
              <div className="subsection-label">SHARED ROLE PROMPTS</div>
              <p className="help-text">
                Optional instructions apply equally to every department. Task
                rules and channel restrictions remain enforced by the server.
              </p>
              <div className="field-grid">
                {ROLES.map((role) => (
                  <label className="field" key={role}>
                    {nice(role)}
                    <textarea
                      rows={3}
                      maxLength={4000}
                      value={config.role_prompts[role] ?? ""}
                      onChange={(e) =>
                        update("role_prompts", {
                          ...config.role_prompts,
                          [role]: e.target.value,
                        })
                      }
                      placeholder={`Additional ${role} instructions…`}
                    />
                  </label>
                ))}
              </div>
              <div className="inline-note">
                <Icon name="memory" size={15} />
                <span>
                  Memory persists between days within a run. Each new run starts
                  with fresh agent memory; previous runs remain available for
                  replay and comparison.
                </span>
              </div>
            </div>
          )}
        </section>
        {error && (
          <div className="error-box">
            <Icon name="warning" size={17} />
            {error}
          </div>
        )}
        <div className="form-footer">
          <p>
            {run
              ? "Creates a fresh run. Your recorded experiment stays intact."
              : "Create a ready experiment, then start it from the live lab."}
          </p>
          <button className="button primary" disabled={busy} type="submit">
            <Icon name="plus" size={17} />
            {busy ? "Creating…" : "Create experiment"}
          </button>
        </div>
      </form>
    </div>
  );
}
