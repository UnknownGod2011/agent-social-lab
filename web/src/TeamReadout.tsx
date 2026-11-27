import { useState } from "react";
import { ARMS, type Run } from "./types";
import { lenses, teamMeasures, type Lens } from "./teamMeasures";

export function LensPicker({
  lens,
  onChange,
}: {
  lens: Lens;
  onChange: (value: Lens) => void;
}) {
  return (
    <div
      className="console-tabs"
      role="group"
      aria-label="Department measurements"
    >
      {lenses.map((value) => (
        <button
          key={value}
          aria-pressed={value === lens}
          onClick={() => onChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

export default function TeamReadout({ run, seq }: { run: Run; seq: number }) {
  const [lens, setLens] = useState<Lens>("Outcomes");
  const measures = teamMeasures(run, lens);
  return (
    <section className="team-readout" aria-label="Department measurements">
      <div className="readout-head">
        <div>
          <h2>Department readout</h2>
          <small>
            Event #{seq} ·{" "}
            {run.config.provider === "mock"
              ? "Synthetic recording"
              : run.config.model}
          </small>
        </div>
        <LensPicker lens={lens} onChange={setLens} />
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Team</th>
            {measures.map((m) => (
              <th scope="col" key={m.label}>
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.config.arms.map((id) => {
            const metrics = run.metrics?.departments[id];
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
                {measures.map((m) => {
                  const fraction = metrics && m.fraction?.(metrics);
                  return (
                    <td key={m.label}>
                      {metrics ? m.value(metrics) : "—"}
                      {typeof fraction === "number" && (
                        <i className="yield-track">
                          <b
                            style={{
                              width: 100 * fraction + "%",
                              background: ARMS[id].color,
                            }}
                          />
                        </i>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
