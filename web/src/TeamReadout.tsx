import { useState } from "react";
import { ARMS, money, num, type Run } from "./types";
const views = ["Outcomes", "Usage", "Channels"] as const;
export default function TeamReadout({ run, seq }: { run: Run; seq: number }) {
  const [view, setView] = useState<(typeof views)[number]>("Outcomes");
  const purchasing = run.config.environment === "supplier_selection_v1",
    mock = run.config.provider === "mock";
  return (
    <section className="team-readout" aria-label="Department measurements">
      <div className="readout-head">
        <div>
          <h2>Department readout</h2>
          <small>
            Event #{seq} · {mock ? "Synthetic recording" : run.config.model}
          </small>
        </div>
        <div className="console-tabs">
          {views.map((v) => (
            <button
              key={v}
              aria-pressed={v === view}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Team</th>
            {(view === "Outcomes"
              ? [
                  purchasing ? "Yield" : "Progress",
                  purchasing ? "Awards" : "Passed",
                  purchasing ? "Scores shared" : "Handoffs",
                  "Work turns",
                ]
              : view === "Usage"
                ? [
                    mock ? "Synthetic calls" : "Model calls",
                    "Tokens",
                    "Est. cost",
                    "Billed cost",
                  ]
                : ["Work", "Table", "Journal", "Total"]
            ).map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.config.arms.map((id) => {
            const m = run.metrics?.departments[id],
              pct = m?.[purchasing ? "decision_yield" : "completion"],
              notes = Number(m?.journal_entries ?? 0);
            return (
              <tr key={id}>
                <th scope="row">
                  <span
                    className="team-letter"
                    style={{ color: ARMS[id].color }}
                  >
                    {id}
                  </span>
                  <span className="full-condition">{ARMS[id].title}</span>
                </th>
                {view === "Outcomes" ? (
                  <>
                    <td>
                      <span className="yield-value">
                        {typeof pct === "number"
                          ? (100 * pct).toFixed(1) + "%"
                          : "—"}
                      </span>
                      <i className="yield-track">
                        <b
                          style={{
                            width:
                              (typeof pct === "number" ? 100 * pct : 0) + "%",
                            background: ARMS[id].color,
                          }}
                        />
                      </i>
                    </td>
                    <td>{m ? m.completed + "/" + m.total : "—"}</td>
                    <td>
                      {num(
                        m?.[purchasing ? "disclosed_score_cells" : "handoffs"],
                      )}
                    </td>
                    <td>{num(m?.work_turns)}</td>
                  </>
                ) : view === "Usage" ? (
                  <>
                    <td>{num(m?.model_calls)}</td>
                    <td>{num(m?.total_tokens)}</td>
                    <td>{money(m?.estimated_cost_usd)}</td>
                    <td>
                      {mock
                        ? "Offline"
                        : m?.actual_cost_usd == null
                          ? "Unreported"
                          : money(m.actual_cost_usd)}
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      {m
                        ? num(m.messages - m.small_talk_messages - notes)
                        : "—"}
                    </td>
                    <td>{num(m?.small_talk_messages)}</td>
                    <td>{num(m?.journal_entries)}</td>
                    <td>{num(m?.messages)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
