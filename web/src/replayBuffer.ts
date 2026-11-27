import { api, hostedDemo, replayRun } from "./api";

type Frame = Awaited<ReturnType<typeof replayRun>>;
const PAGE = 16;
const MAX_FRAMES = 48;

// Keys are immutable event sequence numbers within this one run.
export class ReplayBuffer {
  private frames = new Map<number, Frame>();
  private loading = new Map<number, Promise<void>>();
  constructor(readonly runId: string) {}

  peek(seq: number) {
    return this.frames.get(seq);
  }

  async read(seq: number): Promise<Frame> {
    const cached = this.peek(seq);
    if (cached) return cached;
    const page = hostedDemo ? Math.floor(seq / PAGE) : seq;
    let request = this.loading.get(page);
    if (!request) {
      const load = hostedDemo
        ? api<Frame[]>(`/runs/${this.runId}/replay-pages/${page}`)
        : replayRun(this.runId, seq).then((frame) => [frame]);
      request = load
        .then((frames) => {
          for (const frame of frames) this.frames.set(frame.seq, frame);
          while (this.frames.size > MAX_FRAMES)
            this.frames.delete(this.frames.keys().next().value!);
        })
        .finally(() => this.loading.delete(page));
      this.loading.set(page, request);
    }
    await request;
    const frame = this.peek(seq);
    if (!frame) throw new Error("Missing recorded checkpoint #" + seq);
    return frame;
  }

  async warm(seq: number, end: number, cancelled: () => boolean) {
    const stop = Math.min(end, seq + (hostedDemo ? PAGE : 4));
    for (let next = seq + 1; next <= stop && !cancelled(); next++) {
      try {
        await this.read(next);
      } catch {
        return;
      } // A foreground seek reports the precise failure.
    }
  }
}
