import { useEffect, useState } from "react";
import { api } from "./api";
import type { Config } from "./types";
import { ARMS, DEFAULT_CONFIG, money, nice } from "./types";
import Icon from "./Icon";

type Entry = {
  id: string;
  title: string;
  provider: string;
  model: string;
  block_count: number;
};
type Block = {
  seed: number;
  run_id: string;
  status: string;
  yields: Record<string, number> | null;
};
type Report = Entry & {
  blocks: Block[];
  implementation_matches: boolean;
  analysis: {
    planned: number;
    completed: number;
    missing: number;
    mean_difference: number | null;
    ci95: [number, number] | null;
    attrition_bounds: [number, number];
    interpretation: string;
  };
};
const points = (v: number) => (100 * v).toFixed(1) + " pp";
const difference = (v: number) => (v > 0 ? "+" : "") + points(v);

export default function Studies({
  openRun,
}: {
  openRun: (id: string) => Promise<void>;
}) {
  const [list, setList] = useState<Entry[]>([]);
  const [selected, setSelected] = useState("");
  const [study, setStudy] = useState<Report | null>(null);
  const [title, setTitle] = useState(
    "Purchasing decisions after a shared break",
  );
  const [first, setFirst] = useState(1001);
  const [count, setCount] = useState(3);
  const [days, setDays] = useState(3);
  const [rounds, setRounds] = useState(3);
  const [provider, setProvider] = useState("mock");
  const [model, setModel] = useState("deepseek-flash");
  const [ceiling, setCeiling] = useState(0.5);
  const [callCap, setCallCap] = useState(DEFAULT_CONFIG.max_calls);
  const [tokenCap, setTokenCap] = useState(DEFAULT_CONFIG.max_tokens);
  const [confirmed, setConfirmed] = useState(false);
  const [memory, setMemory] =
    useState<Config["break_memory_mode"]>("attributed");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setConfirmed(false);
  }, [
    provider,
    model,
    first,
    count,
    days,
    rounds,
    memory,
    ceiling,
    callCap,
    tokenCap,
  ]);
  useEffect(() => {
    let active = true;
    api<Entry[]>("/studies")
      .then((data) => {
        if (active) {
          setList(data);
          const requested = new URLSearchParams(location.search).get("study");
          setSelected(
            (id) =>
              id ||
              data.find((s) => s.id === requested)?.id ||
              data[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    if (selected)
      api<Report>("/studies/" + selected)
        .then((data) => {
          if (active) setStudy(data);
        })
        .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [selected, revision]);
  const config: Config = {
    ...DEFAULT_CONFIG,
    name: title,
    provider,
    model: provider === "mock" ? "mock-v1" : model,
    environment: "supplier_selection_v1",
    dialogue_protocol: "topical_chat_v1",
    arms: ["A", "B", "C"],
    seed: first,
    days,
    work_rounds: rounds,
    break_memory_mode: memory,
    tick_ms: 80,
    max_cost_usd: provider === "mock" ? 0 : ceiling,
    paid_confirmed: confirmed,
    max_calls: callCap,
    max_tokens: tokenCap,
  };
  const [calls, setCalls] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    api<{ logical_calls: number }>("/preview", {
      days,
      work_rounds: rounds,
      arms: ["A", "B", "C"],
    })
      .then((p) => active && setCalls(p.logical_calls))
      .catch(() => active && setCalls(null));
    return () => {
      active = false;
    };
  }, [days, rounds]);
  async function register(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<Report>("/studies", {
        title,
        config,
        seeds: Array.from({ length: count }, (_, i) => first + i),
      });
      setStudy(data);
      setSelected(data.id);
      setRevision((r) => r + 1);
      setEnrolling(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="research-page">
      <div className="research-heading">
        <div>
          <span className="eyebrow">RESEARCH PROTOCOL</span>
          <h2>Study registry</h2>
          <p>
            Freeze the question, assign matched cases and follow every team
            through to analysis.
          </p>
        </div>
        <button
          className="button primary"
          aria-expanded={enrolling}
          onClick={() => setEnrolling(!enrolling)}
        >
          <Icon name="plus" size={16} />
          {enrolling ? "Close registration" : "Register a study"}
        </button>
      </div>
      <div className="protocol-diagram">
        <div className="protocol-lead">
          <span className="eyebrow">WORK SAMPLE</span>
          <h3>Supplier selection</h3>
          <p>
            Four private scorecards. One purchasing decision. Six scored tenders
            after the first break.
          </p>
        </div>
        <div className="protocol-arms">
          {(["A", "B", "C"] as const).map((a) => (
            <div key={a} style={{ borderLeftColor: ARMS[a].color }}>
              <b style={{ color: ARMS[a].color }}>{a}</b>
              <span>
                {
                  {
                    A: "Silent break",
                    B: "Private writing",
                    C: "Shared conversation",
                  }[a]
                }
              </span>
            </div>
          ))}
        </div>
        <div className="protocol-readout">
          <span className="eyebrow">PRIMARY CONTRAST</span>
          <strong>C − B</strong>
          <p>
            Paired difference in decision yield at the same work-turn allowance.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {enrolling && (
        <form className="panel registry-form" onSubmit={register}>
          <h3>Allocate matched team runs</h3>
          <div className="registry-inputs">
            <label className="field">
              Study title
              <input
                required
                maxLength={90}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Study provider
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel(
                    e.target.value === "gemini"
                      ? "gemini-3.5-flash-lite"
                      : e.target.value === "openai"
                        ? ""
                        : "deepseek-flash",
                  );
                  setConfirmed(false);
                }}
              >
                <option value="mock">Mock · offline instrument check</option>
                <option value="deepseek">DeepSeek</option>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI compatible</option>
              </select>
            </label>
            {provider !== "mock" && (
              <label className="field">
                Study model
                <input
                  required
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              Starting case seed
              <input
                type="number"
                min={0}
                max={2147483648 - count}
                required
                value={first}
                onChange={(e) => setFirst(+e.target.value)}
              />
            </label>
            <label className="field">
              Matched blocks
              <input
                type="number"
                min={1}
                max={256}
                required
                value={count}
                onChange={(e) => setCount(+e.target.value)}
              />
            </label>
            <label className="field">
              Virtual days
              <input
                type="number"
                min={1}
                max={5}
                required
                value={days}
                onChange={(e) => setDays(+e.target.value)}
              />
            </label>
            <label className="field">
              Rounds per work block
              <input
                type="number"
                min={1}
                max={12}
                required
                value={rounds}
                onChange={(e) => setRounds(+e.target.value)}
              />
            </label>
            <label className="field">
              Break memory during work
              <select
                value={memory}
                onChange={(e) =>
                  setMemory(e.target.value as Config["break_memory_mode"])
                }
              >
                <option value="attributed">Keep the speaker and line</option>
                <option value="anonymous">
                  Keep the line, hide the speaker
                </option>
                <option value="withheld">Withhold all break memories</option>
              </select>
            </label>
            {provider !== "mock" && (
              <label className="field">
                Cost cap per block (USD)
                <input
                  type="number"
                  min={0.001}
                  max={10000}
                  step="any"
                  required
                  value={ceiling}
                  onChange={(e) => {
                    setCeiling(+e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
            )}
          </div>
          <p>
            {calls === null
              ? "Calculating turn allowance…"
              : `${calls} scheduled turns per matched block.`}{" "}
            Maximum estimated study cost{" "}
            {money(provider === "mock" ? 0 : count * ceiling)}.
          </p>
          {provider !== "mock" && (
            <label className="consent">
              <input
                required
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I authorize the displayed live-run caps when I start these blocks.
            </label>
          )}
          <details className="study-limits">
            <summary>Per-block call and token limits</summary>
            <div className="registry-inputs">
              <label className="field">
                Maximum attempts
                <input
                  type="number"
                  min={1}
                  max={100000}
                  required
                  value={callCap}
                  onChange={(e) => setCallCap(+e.target.value)}
                />
              </label>
              <label className="field">
                Maximum tokens
                <input
                  type="number"
                  min={1}
                  max={100000000}
                  required
                  value={tokenCap}
                  onChange={(e) => setTokenCap(+e.target.value)}
                />
              </label>
            </div>
          </details>
          <button className="button primary" disabled={busy} type="submit">
            Freeze protocol and allocate blocks
          </button>
          <small>
            Registration allocates fresh runs. Open a block to start it.
          </small>
        </form>
      )}
      <div className="panel study-report">
        <div className="report-title">
          <h3>Registered blocks</h3>
          {list.length > 0 && (
            <label className="field">
              Study
              <select
                value={selected}
                onChange={(e) => {
                  setStudy(null);
                  setSelected(e.target.value);
                }}
              >
                {list.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.title} · {s.id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button secondary"
            onClick={() => setRevision((r) => r + 1)}
          >
            Refresh results
          </button>
        </div>
        {!study ? (
          <p>
            {list.length
              ? "Loading registered blocks…"
              : "Register a study to allocate its case seeds and freeze its analysis plan."}
          </p>
        ) : (
          <>
            <div className="study-model">
              {study.provider === "mock"
                ? "Offline demonstration"
                : `Live model · ${study.model}`}
            </div>
            <div className="study-tiles">
              <div>
                <small>Completed blocks</small>
                <strong>
                  {study.analysis.completed} / {study.analysis.planned}
                </strong>
              </div>
              <div>
                <small>Mean C − B yield</small>
                <strong>
                  {study.analysis.mean_difference === null
                    ? "Awaiting blocks"
                    : difference(study.analysis.mean_difference)}
                </strong>
              </div>
              <div>
                <small>95% paired interval</small>
                <strong>
                  {study.analysis.ci95?.map(difference).join(" to ") ??
                    (study.provider === "mock"
                      ? "Synthetic run"
                      : "Needs 10 completed blocks")}
                </strong>
              </div>
            </div>
            <p>
              {study.analysis.interpretation} Missing-block bounds:{" "}
              {study.analysis.attrition_bounds.map(difference).join(" to ")}.
            </p>
            {!study.implementation_matches && (
              <p className="error-banner">
                This study was registered on a different engine build. Its
                export remains available.
              </p>
            )}
            <div className="table-scroll">
              <table className="metric-table">
                <thead>
                  <tr>
                    <th>Case seed</th>
                    <th>Status</th>
                    <th>A yield</th>
                    <th>B yield</th>
                    <th>C yield</th>
                    <th>C − B</th>
                    <th>Block</th>
                  </tr>
                </thead>
                <tbody>
                  {study.blocks.map((b) => (
                    <tr key={b.run_id}>
                      <td data-label="Case seed">{b.seed}</td>
                      <td data-label="Status">{nice(b.status)}</td>
                      {["A", "B", "C"].map((a) => (
                        <td key={a} data-label={`${a} yield`}>
                          {b.yields
                            ? (100 * b.yields[a]).toFixed(1) + "%"
                            : "—"}
                        </td>
                      ))}
                      <td data-label="C − B" className="paired-delta">
                        {b.yields ? difference(b.yields.C - b.yields.B) : "—"}
                      </td>
                      <td>
                        <button
                          className="text-action"
                          onClick={() => openRun(b.run_id)}
                        >
                          Open block ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="report-export">
              <code>Protocol {study.id.slice(0, 12)}</code>
              <a
                className="button secondary"
                href={"/api/studies/" + study.id + "/export"}
                download
              >
                <Icon name="download" size={15} />
                Download study JSON
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
