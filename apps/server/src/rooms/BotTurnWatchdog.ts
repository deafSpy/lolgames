/**
 * BotTurnWatchdog — defense-in-depth guard against stuck bot turns.
 *
 * Two protections:
 *  1. Timeout: if a bot hasn't completed its turn within `timeoutMs`, force
 *     advance the turn via `onTimeout`.
 *  2. Consecutive guard: if the same bot ID is assigned more than
 *     `maxConsecutiveTurns` turns in a row without any other player acting,
 *     call `onConsecutiveExceeded` and immediately trigger a force-advance.
 *
 * Accepts a `scheduler` factory so it works with Colyseus room clocks in
 * production and with native setTimeout / fake timers in tests.
 */

export interface TimerHandle {
  clear(): void;
}

export type TimerScheduler = (callback: () => void, delayMs: number) => TimerHandle;

export interface WatchdogOptions {
  timeoutMs?: number;
  maxConsecutiveTurns?: number;
}

export class BotTurnWatchdog {
  private timer: TimerHandle | null = null;
  private consecutiveTurnCount = 0;
  private consecutiveBotId = "";

  private readonly timeoutMs: number;
  private readonly maxConsecutive: number;

  constructor(
    private readonly scheduler: TimerScheduler,
    private readonly onTimeout: (botId: string) => void,
    private readonly onConsecutiveExceeded: (botId: string, count: number) => void,
    options: WatchdogOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxConsecutive = options.maxConsecutiveTurns ?? 3;
  }

  /**
   * Start (or restart) the watchdog for a bot's turn.
   * Call this whenever a bot becomes the current player.
   */
  startForBot(botId: string): void {
    this.clear();

    if (botId === this.consecutiveBotId) {
      this.consecutiveTurnCount++;
    } else {
      this.consecutiveTurnCount = 1;
      this.consecutiveBotId = botId;
    }

    if (this.consecutiveTurnCount > this.maxConsecutive) {
      this.onConsecutiveExceeded(botId, this.consecutiveTurnCount);
      // Force-advance via an immediate async tick to avoid synchronous recursion
      this.timer = this.scheduler(() => {
        this.onTimeout(botId);
      }, 0);
      return;
    }

    this.timer = this.scheduler(() => {
      this.onTimeout(botId);
    }, this.timeoutMs);
  }

  /**
   * Notify the watchdog that a human player has acted.
   * Clears the timer and resets the consecutive-bot-turn counter.
   */
  resetForHuman(): void {
    this.clear();
    this.consecutiveTurnCount = 0;
    this.consecutiveBotId = "";
  }

  /**
   * Stop the active watchdog timer without resetting counters.
   * Call when the game ends or the room is disposed.
   */
  clear(): void {
    if (this.timer) {
      this.timer.clear();
      this.timer = null;
    }
  }

  get currentConsecutiveCount(): number {
    return this.consecutiveTurnCount;
  }

  get currentConsecutiveBotId(): string {
    return this.consecutiveBotId;
  }
}
