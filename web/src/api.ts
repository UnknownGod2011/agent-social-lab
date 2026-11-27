/// <reference types="vite/client" />
import type { Config, LabEvent, Metrics, Run, State } from "./types";

export const hostedDemo = import.meta.env.MODE === "public";

function demoPath(path: string) {
  const [resource, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (resource === "/compare")
    return `/demo/api/compare/${params.get("ids")}.json`;
  if (resource.endsWith("/replay"))
    return `/demo/api${resource}/${params.get("seq") ?? 0}.json`;
  return `/demo/api${resource}.json`;
}

export function downloadPath(path: string) {
  return hostedDemo
    ? `/demo/api${path}${path.endsWith("/export") ? ".json" : ""}`
    : `/api${path}`;
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (hostedDemo && body !== undefined) {
    throw new Error(
      "The hosted demonstration contains recorded data. New runs use the research workspace.",
    );
  }
  const response = await fetch(hostedDemo ? demoPath(path) : `/api${path}`, {
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
export async function getEvents(
  id: string,
  through: number,
): Promise<LabEvent[]> {
  if (hostedDemo) return api<LabEvent[]>("/runs/" + id + "/events");
  const result: LabEvent[] = [];
  let after = 0;
  while (after < through) {
    const page = await api<LabEvent[]>(
      "/runs/" +
        id +
        "/events?after=" +
        after +
        "&limit=" +
        Math.min(2000, through - after),
    );
    if (!page.length || page[0].seq !== after + 1)
      throw new Error(
        "The event history is incomplete at event " + (after + 1) + ".",
      );
    result.push(...page);
    after = page[page.length - 1].seq;
  }
  return result;
}
export const replayRun = (id: string, seq: number) =>
  api<{ state: State; seq: number; metrics: Metrics }>(
    `/runs/${id}/replay?seq=${seq}`,
  );
