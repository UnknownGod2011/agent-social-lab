import { money, num, type DepartmentMetrics, type Run } from "./types";

export const lenses = ["Outcomes", "Usage", "Channels"] as const;
export type Lens = (typeof lenses)[number];
type Measure = {
  label: string;
  value: (metrics: DepartmentMetrics) => string;
  fraction?: (metrics: DepartmentMetrics) => unknown;
};
const count = (label: string, key: string): Measure => ({
  label,
  value: (m) => num(m[key]),
});

export function teamMeasures(run: Run, lens: Lens): Measure[] {
  const purchasing = run.config.environment === "supplier_selection_v1";
  const mock = run.config.provider === "mock";
  if (lens === "Usage")
    return [
      count(mock ? "Synthetic calls" : "Model calls", "model_calls"),
      count("Tokens", "total_tokens"),
      { label: "Est. cost", value: (m) => money(m.estimated_cost_usd) },
      {
        label: "Billed cost",
        value: (m) =>
          mock
            ? "Offline"
            : m.actual_cost_usd == null
              ? "Unreported"
              : money(m.actual_cost_usd),
      },
    ];
  if (lens === "Channels")
    return [
      {
        label: "Work",
        value: (m) =>
          num(
            m.messages - m.small_talk_messages - Number(m.journal_entries ?? 0),
          ),
      },
      count("Table", "small_talk_messages"),
      count("Journal", "journal_entries"),
      count("Total", "messages"),
    ];
  const fraction = (m: DepartmentMetrics) =>
    purchasing ? m.decision_yield : m.completion;
  return [
    {
      label: purchasing ? "Decision yield" : "Progress",
      fraction,
      value: (m) => {
        const value = fraction(m);
        return typeof value === "number" ? (100 * value).toFixed(1) + "%" : "—";
      },
    },
    {
      label: purchasing ? "Cases awarded" : "Milestones passed",
      value: (m) => m.completed + "/" + m.total,
    },
    count(
      purchasing ? "Scores shared" : "Handoffs",
      purchasing ? "disclosed_score_cells" : "handoffs",
    ),
    count("Work turns", "work_turns"),
  ];
}
