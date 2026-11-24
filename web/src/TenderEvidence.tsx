import { useEffect, useState } from "react";
import { api } from "./api";
import { ROLES, nice, type Task } from "./types";

type Cards = Record<string, Record<string, number>>;
type Casebook = { cases: Record<string, { cards: Cards }> };

export default function TenderEvidence({
  runId,
  tasks,
}: {
  runId: string;
  tasks: Task[];
}) {
  const [which, setWhich] = useState("case-1");
  const [perspective, setPerspective] = useState("public");
  const [book, setBook] = useState<Casebook | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBook(null);
    setError("");
    api<Casebook>("/runs/" + runId + "/casebook")
      .then((value) => active && setBook(value))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [runId]);
  const task = tasks.find((t) => t.id === which);
  const cards = book?.cases[which]?.cards;
  const published = task?.disclosed ?? {};
  const chosen = (task?.artifact as { supplier?: string } | undefined)
    ?.supplier;
  const mode = perspective === "evaluator" && !chosen ? "public" : perspective;
  const suppliers = Object.keys(cards?.coordinator ?? {});
  return (
    <section className="evidence-panel" aria-label="Tender evidence viewer">
      <div className="evidence-controls">
        <label className="field">
          Inspect tender
          <select value={which} onChange={(e) => setWhich(e.target.value)}>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          View from
          <select value={mode} onChange={(e) => setPerspective(e.target.value)}>
            <option value="public">Team disclosures</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {nice(r)}
              </option>
            ))}
            {chosen && <option value="evaluator">Evaluator</option>}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !cards ? (
        <p>Loading the recorded casebook…</p>
      ) : (
        <>
          <table className="evidence-grid">
            <caption>Supplier scores on a 1–9 scale</caption>
            <thead>
              <tr>
                <th scope="col">Role</th>
                {suppliers.map((s) => (
                  <th key={s} scope="col">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => (
                <tr key={role}>
                  <th scope="row">{nice(role)}</th>
                  {suppliers.map((s) => {
                    const shared = published[role]?.[s] !== undefined,
                      visible = mode === role || mode === "evaluator";
                    return (
                      <td
                        key={s}
                        className={
                          shared
                            ? "public-cell"
                            : visible
                              ? "private-cell"
                              : "hidden-cell"
                        }
                        title={
                          shared
                            ? "Published score"
                            : visible
                              ? "Private scorecard"
                              : "Undisclosed"
                        }
                      >
                        {shared
                          ? published[role][s]
                          : visible
                            ? cards[role][s]
                            : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="evidence-key">
            <span>
              <i />
              Published
            </span>
            <span>
              <i />
              Private to role
            </span>
            <span>· Undisclosed</span>
          </div>
          {chosen && (
            <p>
              Contract awarded to <strong>{chosen}</strong>. The evaluator view
              reveals all four scorecards.
            </p>
          )}
        </>
      )}
    </section>
  );
}
