import type { Config, LabEvent, Metrics, Run, State } from "./types";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail ?? data),
    );
  }
  return response.json();
}
export const getRuns = () => api<Run[]>("/runs");
export const getRun = (id: string) => api<Run>(`/runs/${id}`);
export const createRun = (config: Config) => api<Run>("/runs", config);
export const controlRun = (id: string, command: string) =>
  api<Run>(`/runs/${id}/control`, { command });
export const getEvents = (id: string) =>
  api<LabEvent[]>(`/runs/${id}/events?limit=100000`);
export const replayRun = (id: string, seq: number) =>
  api<{ state: State; seq: number; metrics: Metrics }>(
    `/runs/${id}/replay?seq=${seq}`,
  );
