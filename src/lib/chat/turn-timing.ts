/**
 * Per-request phase timer for the chat send path. Each `mark` records the time
 * spent since the previous mark; `flush` logs one `[CHAT_TIMING]` line, so the
 * cost of auth, session, quota, history ... up to the first model token can be
 * compared before and after a change.
 */
export class TurnTimer {
  private readonly startedAt = performance.now();
  private lastAt = this.startedAt;
  private readonly phases: Array<[string, number]> = [];
  private flushed = false;

  constructor(
    private readonly requestId: string,
    private readonly label: string
  ) {}

  mark(phase: string): void {
    const now = performance.now();
    this.phases.push([phase, Math.round(now - this.lastAt)]);
    this.lastAt = now;
  }

  /** Logs once; later calls are ignored. */
  flush(): void {
    if (this.flushed) return;
    this.flushed = true;
    const total = Math.round(performance.now() - this.startedAt);
    const parts = this.phases.map(([name, ms]) => `${name}=${ms}ms`).join(" ");
    console.info(`[CHAT_TIMING] [${this.requestId}] ${this.label} ${parts} total=${total}ms`);
  }
}
