import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BotTurnWatchdog, type TimerScheduler } from "./BotTurnWatchdog.js";

// ---------------------------------------------------------------------------
// Unit tests for DEA-218: BotTurnWatchdog
//
// The watchdog has two guards:
//  1. Timeout: if a bot's turn isn't completed within `timeoutMs`, call onTimeout.
//  2. Consecutive: if the same bot ID appears >maxConsecutiveTurns times in a
//     row, call onConsecutiveExceeded and schedule an immediate force-advance.
//
// Tests use vitest fake timers so no real time elapses.
// ---------------------------------------------------------------------------

function makeNativeScheduler(): TimerScheduler {
  return (cb, ms) => {
    const id = setTimeout(cb, ms);
    return { clear: () => clearTimeout(id) };
  };
}

describe("BotTurnWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Timeout guard ──────────────────────────────────────────────────────────

  describe("timeout guard", () => {
    it("calls onTimeout after timeoutMs if turn was never completed", () => {
      const onTimeout = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, vi.fn(), {
        timeoutMs: 1000,
      });

      watchdog.startForBot("bot1");
      vi.advanceTimersByTime(999);
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledOnce();
      expect(onTimeout).toHaveBeenCalledWith("bot1");
    });

    it("does not call onTimeout when timer is cleared before expiry", () => {
      const onTimeout = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, vi.fn(), {
        timeoutMs: 1000,
      });

      watchdog.startForBot("bot1");
      watchdog.clear();
      vi.advanceTimersByTime(2000);

      expect(onTimeout).not.toHaveBeenCalled();
    });

    it("resets the timer when startForBot is called again before expiry", () => {
      const onTimeout = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, vi.fn(), {
        timeoutMs: 1000,
      });

      watchdog.startForBot("bot1");
      vi.advanceTimersByTime(800);

      // Restart (e.g. nextTurn called again for the same bot)
      watchdog.startForBot("bot1");
      vi.advanceTimersByTime(800); // still < 1000 from the second start
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200); // total 1000 from second start
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it("does not call onTimeout when resetForHuman is called", () => {
      const onTimeout = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, vi.fn(), {
        timeoutMs: 1000,
      });

      watchdog.startForBot("bot1");
      watchdog.resetForHuman();
      vi.advanceTimersByTime(2000);

      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  // ── Consecutive guard ──────────────────────────────────────────────────────

  describe("consecutive turn guard", () => {
    it("does not trigger consecutive guard within max limit", () => {
      const onConsecutive = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), onConsecutive, {
        timeoutMs: 10_000,
        maxConsecutiveTurns: 3,
      });

      watchdog.startForBot("bot1"); // count 1
      watchdog.clear();
      watchdog.startForBot("bot1"); // count 2
      watchdog.clear();
      watchdog.startForBot("bot1"); // count 3 — exactly at limit, not exceeded
      watchdog.clear();

      expect(onConsecutive).not.toHaveBeenCalled();
    });

    it("calls onConsecutiveExceeded and force-advances when count > max", () => {
      const onTimeout = vi.fn();
      const onConsecutive = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, onConsecutive, {
        timeoutMs: 10_000,
        maxConsecutiveTurns: 3,
      });

      for (let i = 0; i < 3; i++) {
        watchdog.startForBot("bot1");
        watchdog.clear();
      }
      expect(onConsecutive).not.toHaveBeenCalled();

      // 4th turn — exceeds limit
      watchdog.startForBot("bot1");
      expect(onConsecutive).toHaveBeenCalledOnce();
      expect(onConsecutive).toHaveBeenCalledWith("bot1", 4);

      // Force-advance fires via immediate timer
      vi.advanceTimersByTime(0);
      expect(onTimeout).toHaveBeenCalledOnce();
      expect(onTimeout).toHaveBeenCalledWith("bot1");
    });

    it("resets consecutive count when a different bot takes the turn", () => {
      const onConsecutive = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), onConsecutive, {
        timeoutMs: 10_000,
        maxConsecutiveTurns: 3,
      });

      for (let i = 0; i < 3; i++) {
        watchdog.startForBot("bot1");
        watchdog.clear();
      }
      // Switch to different bot — resets counter
      watchdog.startForBot("bot2");
      watchdog.clear();

      expect(onConsecutive).not.toHaveBeenCalled();
      expect(watchdog.currentConsecutiveCount).toBe(1);
      expect(watchdog.currentConsecutiveBotId).toBe("bot2");
    });

    it("resets consecutive count when human acts via resetForHuman", () => {
      const onConsecutive = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), onConsecutive, {
        timeoutMs: 10_000,
        maxConsecutiveTurns: 3,
      });

      for (let i = 0; i < 3; i++) {
        watchdog.startForBot("bot1");
        watchdog.clear();
      }

      watchdog.resetForHuman(); // human acted — reset
      watchdog.startForBot("bot1"); // count restarts at 1

      expect(onConsecutive).not.toHaveBeenCalled();
      expect(watchdog.currentConsecutiveCount).toBe(1);
    });

    it("consecutive count tracks the correct bot ID", () => {
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), vi.fn(), {
        timeoutMs: 10_000,
        maxConsecutiveTurns: 3,
      });

      watchdog.startForBot("bot1");
      watchdog.clear();
      watchdog.startForBot("bot1");
      watchdog.clear();

      expect(watchdog.currentConsecutiveCount).toBe(2);
      expect(watchdog.currentConsecutiveBotId).toBe("bot1");
    });
  });

  // ── Clear / lifecycle ──────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("clear() is idempotent — calling it multiple times does not throw", () => {
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), vi.fn());

      watchdog.startForBot("bot1");
      expect(() => {
        watchdog.clear();
        watchdog.clear();
        watchdog.clear();
      }).not.toThrow();
    });

    it("resetForHuman on fresh watchdog does not throw", () => {
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), vi.fn());
      expect(() => watchdog.resetForHuman()).not.toThrow();
    });

    it("startForBot after clear works correctly", () => {
      const onTimeout = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, vi.fn(), {
        timeoutMs: 500,
      });

      watchdog.startForBot("bot1");
      watchdog.clear();
      watchdog.startForBot("bot1"); // should restart cleanly

      vi.advanceTimersByTime(500);
      expect(onTimeout).toHaveBeenCalledOnce();
    });
  });

  // ── Custom timeout values ──────────────────────────────────────────────────

  describe("custom options", () => {
    it("uses default 10s timeout when no options provided", () => {
      const onTimeout = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), onTimeout, vi.fn());

      watchdog.startForBot("bot1");
      vi.advanceTimersByTime(9999);
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it("uses default maxConsecutiveTurns of 3 when no options provided", () => {
      const onConsecutive = vi.fn();
      const watchdog = new BotTurnWatchdog(makeNativeScheduler(), vi.fn(), onConsecutive);

      for (let i = 0; i < 3; i++) {
        watchdog.startForBot("bot1");
        watchdog.clear();
      }
      expect(onConsecutive).not.toHaveBeenCalled();

      watchdog.startForBot("bot1"); // 4th — exceeds default of 3
      expect(onConsecutive).toHaveBeenCalledOnce();
    });
  });
});
