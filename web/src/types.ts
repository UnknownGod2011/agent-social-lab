export type Arm = "A" | "B" | "C";
export type Config = {
  name: string;
  days: number;
  arms: Arm[];
  seed: number;
  provider: string;
  model: string;
  scheduler_mode: string;
  wake_time: string;
  timezone: string;
  tick_ms: number;
  work_rounds: number;
  talk_frequency: number;
  break_length: number;
  max_calls: number;
  max_tokens: number;
  max_cost_usd: number;
  max_output_tokens: number;
  role_prompts: Record<string, string>;
  paid_confirmed: boolean;
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  activity: string;
  location: string;
  memory: {
    day: number;
    channel?: string;
    text?: string;
    action?: { type: string; task_id?: string };
    reason?: string;
    evidence?: unknown;
  }[];
};
export type Task = {
  id: string;
  title: string;
  acceptance: string;
  dependencies: string[];
  status: string;
  owner?: string;
  artifact?: unknown;
  version?: number;
  review?: unknown;
};
export type Department = {
  id: Arm;
  condition: string;
  initial_hash: string;
  agents: Agent[];
  tasks: Task[];
};
export type State = {
  status: string;
  virtual_day: number;
  phase: string;
  virtual_minute: number;
  cursor: unknown;
  departments: Partial<Record<Arm, Department>>;
};
export type DepartmentMetrics = {
  completed: number;
  total: number;
  completion: number;
  invalid_actions: number;
  blocked_actions: number;
  help_given: number;
  handoffs: number;
  repairs: number;
  duplicates_avoided: number;
  work_turns: number;
  messages: number;
  small_talk_messages: number;
  input_tokens: number;
  output_tokens: number;
  model_calls: number;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  [key: string]: unknown;
};
export type Metrics = {
  departments: Partial<Record<Arm, DepartmentMetrics>>;
  [key: string]: unknown;
};
export type Run = {
  id: string;
  config: Config;
  status: string;
  created_at?: string;
  config_hash: string;
  initial_state_hash: string;
  state?: State;
  metrics?: Metrics;
  seq?: number;
  budget?: {
    calls: number;
    tokens: number;
    estimated_cost_usd: number;
    uncertain_attempts: number;
  };
  next_due?: string | null;
  retry_at?: string | null;
};
export type LabEvent = {
  event_id: string;
  run_id: string;
  seq: number;
  virtual_day: number;
  ts_utc: string;
  department_id?: Arm;
  condition?: string;
  agent_id?: string;
  event_type: string;
  channel?: string;
  task_id?: string;
  payload_json: Record<string, unknown>;
  severity: string;
  provider_model?: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  elapsed_ms?: number;
  state_hash?: string;
};
export const DEFAULT_CONFIG: Config = {
  name: "The small talk experiment",
  days: 3,
  arms: ["A", "C"],
  seed: 42,
  provider: "mock",
  model: "gemini-3.5-flash-lite",
  scheduler_mode: "virtual",
  wake_time: "09:00",
  timezone: "Asia/Kolkata",
  tick_ms: 250,
  work_rounds: 3,
  talk_frequency: 1,
  break_length: 30,
  max_calls: 1000,
  max_tokens: 1000000,
  max_cost_usd: 2,
  max_output_tokens: 768,
  role_prompts: {},
  paid_confirmed: false,
};
export const ARMS: Record<
  Arm,
  { title: string; subtitle: string; color: string }
> = {
  A: {
    title: "Work only",
    subtitle: "Silent breaks · shared project",
    color: "#a9bcad",
  },
  B: {
    title: "Solo reflection",
    subtitle: "Private journal · shared project",
    color: "#b4a4cf",
  },
  C: {
    title: "Work + small talk",
    subtitle: "Table conversation · shared project",
    color: "#e9b887",
  },
};
export const ROLES = ["coordinator", "builder", "verifier", "integrator"];
export const COLORS = ["#e7b879", "#a7beb0", "#b3a5cf", "#de9c8a"];
export const nice = (text: unknown) =>
  String(text ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
export const money = (n: unknown) =>
  typeof n === "number"
    ? `$${n.toFixed(n < 0.01 && n > 0 ? 5 : 2)}`
    : "Not reported";
export const num = (n: unknown) =>
  typeof n === "number"
    ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "—";
export const minute = (n?: number) =>
  n === undefined
    ? "09:00"
    : `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
