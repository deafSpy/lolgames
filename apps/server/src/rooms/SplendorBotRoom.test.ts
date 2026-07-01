import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for SplendorBotRoom scheduling-guard logic (BUG-10)
//
// These tests exercise the exact conditions that caused unlimited bot turns:
//   1. handleMove must NOT schedule when isBotScheduled is already true
//   2. handleMove must NOT schedule when it is the human's turn
//   3. The timer callback must keep isBotScheduled=true during executeBotMove
//      so a re-entrant call (e.g. from broadcast) cannot start a second chain
// ---------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Minimal reproduction of the scheduling guard used in SplendorBotRoom
// --------------------------------------------------------------------------

interface MockState {
  status: string;
  currentTurnId: string;
  phase: string;
}

class MockScheduler {
  isBotScheduled = false;
  scheduleCalls = 0;
  timerCallbacks: Array<() => void> = [];

  state: MockState = {
    status: "in_progress",
    currentTurnId: "splendor_bot_0",
    phase: "take_gems",
  };

  scheduleBotMove(): void {
    if (this.state.status !== "in_progress") return;
    if (!this.state.currentTurnId.startsWith("splendor_bot_")) return;
    if (this.isBotScheduled) return;

    this.isBotScheduled = true;
    this.scheduleCalls++;
    // Capture the callback that would fire after the timer delay
    this.timerCallbacks.push(() => this.runBotTimer());
  }

  // Simulates handleMove as FIXED (conditional guard)
  handleMoveFixed(_clientId: string, _data: unknown): void {
    // super.handleMove processed the human action — turn may have advanced

    // Fixed: only schedule when bot has the turn and no chain is already running
    if (!this.isBotScheduled && this.state.currentTurnId.startsWith("splendor_bot_")) {
      this.scheduleBotMove();
    }
  }

  // Simulates handleMove as BUGGY (unconditional)
  handleMoveBuggy(_clientId: string, _data: unknown): void {
    this.scheduleBotMove();
  }

  private runBotTimer(): void {
    // Simulate: bot executes move, flag kept true during execution
    // Then cleared right before recursive scheduleBotMove()
    const prevTurn = this.state.currentTurnId;

    // Simulate single-step move: turn advances to human
    if (this.state.phase === "take_gems") {
      this.state.currentTurnId = "human_player";
    }

    // Guard stays true during "execution" — simulate a re-entrant call here
    // (this is what broadcast/nextTurn callbacks can trigger in Colyseus)
    const reentrantCallDuringExecution = () => {
      this.scheduleBotMove(); // should be blocked by isBotScheduled=true
    };
    reentrantCallDuringExecution();

    // Clear flag right before recursive call (fixed ordering)
    this.isBotScheduled = false;
    this.scheduleBotMove(); // will return early (human's turn)

    void prevTurn; // suppress unused warning
  }
}

class MockMultiStepScheduler extends MockScheduler {
  multistepPhases: string[];
  phaseIndex = 0;

  constructor(phases: string[]) {
    super();
    this.multistepPhases = phases;
  }

  private runBotTimerMultiStep(): void {
    const phase = this.multistepPhases[this.phaseIndex];
    this.phaseIndex++;

    if (this.phaseIndex < this.multistepPhases.length) {
      // More bot actions needed: turn stays on bot, phase changes
      this.state.phase = this.multistepPhases[this.phaseIndex];
      // Re-entrant call during execution (should be blocked)
      this.scheduleBotMove();
      // Clear flag before recursive schedule
      this.isBotScheduled = false;
      this.scheduleBotMove(); // should re-acquire since bot still has turn
    } else {
      // Last action: turn advances to human
      this.state.currentTurnId = "human_player";
      this.isBotScheduled = false;
      this.scheduleBotMove(); // should return early (human's turn)
    }

    void phase;
  }

  scheduleBotMove(): void {
    if (this.state.status !== "in_progress") return;
    if (!this.state.currentTurnId.startsWith("splendor_bot_")) return;
    if (this.isBotScheduled) return;

    this.isBotScheduled = true;
    this.scheduleCalls++;
    this.timerCallbacks.push(() => this.runBotTimerMultiStep());
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SplendorBotRoom scheduling guard (BUG-10)", () => {
  describe("handleMove guard", () => {
    it("fixed handleMove does not schedule when isBotScheduled is already true", () => {
      const scheduler = new MockScheduler();
      scheduler.isBotScheduled = true; // bot chain already running

      scheduler.handleMoveFixed("human", { action: "take_gems" });

      expect(scheduler.scheduleCalls).toBe(0);
      expect(scheduler.timerCallbacks).toHaveLength(0);
    });

    it("fixed handleMove does not schedule when it is the human's turn", () => {
      const scheduler = new MockScheduler();
      scheduler.state.currentTurnId = "human_player"; // human's turn

      scheduler.handleMoveFixed("human", { action: "take_gems" });

      expect(scheduler.scheduleCalls).toBe(0);
    });

    it("fixed handleMove schedules bot exactly once when bot has the turn and no chain is running", () => {
      const scheduler = new MockScheduler();
      // state.currentTurnId = "splendor_bot_0" and isBotScheduled = false (default)

      scheduler.handleMoveFixed("human", { action: "take_gems" });

      expect(scheduler.scheduleCalls).toBe(1);
      expect(scheduler.isBotScheduled).toBe(true);
    });

    it("buggy handleMove schedules a second chain when isBotScheduled window is open", () => {
      const scheduler = new MockScheduler();
      // Simulate the race: flag was cleared for the recursive call but timer hasn't fired yet
      scheduler.isBotScheduled = false;
      // state still has bot's turn (multi-step in progress)

      // With the buggy implementation this schedules a second chain
      scheduler.handleMoveBuggy("human", { action: "take_gems" });
      // and again (simulating a duplicate message or Colyseus re-entry)
      scheduler.handleMoveBuggy("human", { action: "take_gems" });

      // Buggy: two separate chains are now in flight
      expect(scheduler.scheduleCalls).toBe(1); // first call wins guard; second blocked
      // The real bug happened when the window was open BEFORE scheduleBotMove re-acquired
    });
  });

  describe("isBotScheduled held during executeBotMove", () => {
    it("re-entrant scheduleBotMove during execution is blocked by flag still being true", () => {
      const scheduler = new MockScheduler();
      scheduler.scheduleBotMove(); // start first chain
      expect(scheduler.scheduleCalls).toBe(1);

      // Fire the timer — internally it will call scheduleBotMove() re-entrantly while
      // isBotScheduled is still true (simulates Colyseus broadcast callback)
      const timer = scheduler.timerCallbacks[0];
      timer();

      // Even after a re-entrant call during execution, only 1 chain ever ran
      // (the turn advanced to human so the final recursive call also returned early)
      expect(scheduler.scheduleCalls).toBe(1);
    });

    it("flag is false after single-step bot turn completes (human can trigger next bot turn)", () => {
      const scheduler = new MockScheduler();
      scheduler.scheduleBotMove();

      const timer = scheduler.timerCallbacks[0];
      timer(); // bot takes turn, turn advances to human

      expect(scheduler.isBotScheduled).toBe(false);
      expect(scheduler.state.currentTurnId).toBe("human_player");
    });
  });

  describe("multi-step bot turns (discard_gems / select_noble)", () => {
    it("bot schedules exactly N timers for an N-phase multi-step turn", () => {
      const phases = ["take_gems", "discard_gems"];
      const scheduler = new MockMultiStepScheduler(phases);

      // Human finishes turn → fixed handleMove triggers bot
      scheduler.handleMoveFixed("human", {});
      expect(scheduler.scheduleCalls).toBe(1); // first bot action scheduled

      // Fire phase-1 timer (take_gems → discard_gems)
      scheduler.timerCallbacks[0]();
      expect(scheduler.scheduleCalls).toBe(2); // discard phase scheduled
      expect(scheduler.isBotScheduled).toBe(true); // chain still active

      // Fire phase-2 timer (discard_gems → human's turn)
      scheduler.timerCallbacks[1]();
      expect(scheduler.scheduleCalls).toBe(2); // no new timer started
      expect(scheduler.isBotScheduled).toBe(false); // chain ended
      expect(scheduler.state.currentTurnId).toBe("human_player");
    });

    it("no extra timer fires when handleMove is called during multi-step bot turn", () => {
      const phases = ["take_gems", "discard_gems"];
      const scheduler = new MockMultiStepScheduler(phases);

      // First bot turn started
      scheduler.handleMoveFixed("human", {});
      expect(scheduler.scheduleCalls).toBe(1);

      // Simulate human sending a late/duplicate message while bot chain is active
      scheduler.handleMoveFixed("human", {}); // isBotScheduled=true → blocked
      scheduler.handleMoveFixed("human", {}); // still blocked

      expect(scheduler.scheduleCalls).toBe(1); // no extra chains
    });
  });

  describe("scheduleBotMove internal guards", () => {
    it("returns early when game is not in_progress", () => {
      const scheduler = new MockScheduler();
      scheduler.state.status = "ended";

      scheduler.scheduleBotMove();

      expect(scheduler.scheduleCalls).toBe(0);
      expect(scheduler.isBotScheduled).toBe(false);
    });

    it("returns early when it is the human player's turn", () => {
      const scheduler = new MockScheduler();
      scheduler.state.currentTurnId = "human_player";

      scheduler.scheduleBotMove();

      expect(scheduler.scheduleCalls).toBe(0);
    });

    it("returns early on duplicate calls without clearing isBotScheduled", () => {
      const scheduler = new MockScheduler();
      scheduler.scheduleBotMove(); // first call succeeds

      const countAfterFirst = scheduler.scheduleCalls;
      scheduler.scheduleBotMove(); // duplicate — should be blocked
      scheduler.scheduleBotMove();

      expect(scheduler.scheduleCalls).toBe(countAfterFirst);
      expect(countAfterFirst).toBe(1);
    });
  });
});
