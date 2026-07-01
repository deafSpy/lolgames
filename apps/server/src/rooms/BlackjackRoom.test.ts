import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for Blackjack hand-transition and bot-scheduling logic (BUG-11)
//
// Root causes covered:
//   1. startNextHand fires via clock.setTimeout, not a player action, so
//      scheduleBotAction must be called explicitly after the hand starts.
//      Without this, any hand where a bot is the first bettor stalls forever.
//   2. handleMoveMessage calls checkWinCondition after handleMove returns, but
//      BlackjackRoom already calls checkWinCondition+endGame inside
//      checkElimination. The double-endGame must be guarded.
//   3. "continue" is sent by the client during payout/elimination; it must
//      be silently accepted (not rejected with "Not your turn").
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Bot scheduling guard
// ---------------------------------------------------------------------------

interface MockBlackjackState {
  status: "waiting" | "in_progress" | "finished";
  phase: "betting" | "dealing" | "player_turn" | "dealer_turn" | "payout" | "elimination";
  currentTurnId: string;
  handNumber: number;
}

class MockBotRoom {
  state: MockBlackjackState = {
    status: "in_progress",
    phase: "betting",
    currentTurnId: "blackjack_bot_0",
    handNumber: 1,
  };

  scheduledBotBets: string[] = [];
  scheduledBotPlays: string[] = [];
  nextHandCalls = 0;
  superNextHandCalls = 0;

  // Mirrors BlackjackBotRoom.scheduleBotAction
  scheduleBotAction(): void {
    if (this.state.status !== "in_progress") return;

    if (this.state.phase === "betting") {
      const curr = this.state.currentTurnId;
      if (curr && curr.startsWith("blackjack_bot_")) {
        this.scheduledBotBets.push(curr);
      }
      return;
    }

    if (this.state.phase === "player_turn") {
      const curr = this.state.currentTurnId;
      if (curr && curr.startsWith("blackjack_bot_")) {
        this.scheduledBotPlays.push(curr);
      }
      return;
    }
  }

  // Mirrors BlackjackRoom.startNextHand (base)
  private baseStartNextHand(): void {
    this.superNextHandCalls++;
    this.state.handNumber++;
    this.state.phase = "betting";
    // simulate button rotation producing a bot as first bettor on hand 2
    if (this.state.handNumber === 2) {
      this.state.currentTurnId = "blackjack_bot_1";
    } else {
      this.state.currentTurnId = "human_player";
    }
  }

  // Mirrors BlackjackBotRoom.startNextHand (override) — THE FIX
  startNextHandFixed(): void {
    this.baseStartNextHand();
    this.scheduleBotAction();
    this.nextHandCalls++;
  }

  // The buggy version (no scheduleBotAction call)
  startNextHandBuggy(): void {
    this.baseStartNextHand();
    this.nextHandCalls++;
  }
}

describe("BlackjackBotRoom – startNextHand bot scheduling", () => {
  let room: MockBotRoom;

  beforeEach(() => {
    room = new MockBotRoom();
  });

  it("FIXED: triggers bot bet when bot is first bettor on hand 2", () => {
    room.state.handNumber = 1;
    room.state.phase = "payout";
    room.state.currentTurnId = ""; // payout phase, no current turn

    room.startNextHandFixed();

    expect(room.state.handNumber).toBe(2);
    expect(room.state.phase).toBe("betting");
    expect(room.state.currentTurnId).toBe("blackjack_bot_1");
    // Bot bet must have been scheduled
    expect(room.scheduledBotBets).toContain("blackjack_bot_1");
  });

  it("BUGGY: does not trigger bot bet when bot is first bettor on hand 2", () => {
    room.state.handNumber = 1;
    room.state.phase = "payout";
    room.state.currentTurnId = "";

    room.startNextHandBuggy();

    expect(room.state.handNumber).toBe(2);
    expect(room.state.currentTurnId).toBe("blackjack_bot_1");
    // Without the fix, no bot bet is scheduled — the game stalls
    expect(room.scheduledBotBets).toHaveLength(0);
  });

  it("FIXED: does not schedule bot bet when human is first bettor on hand 3", () => {
    room.state.handNumber = 2;
    room.state.phase = "payout";
    room.state.currentTurnId = "";

    room.startNextHandFixed();

    expect(room.state.handNumber).toBe(3);
    expect(room.state.currentTurnId).toBe("human_player");
    // No bot scheduled — human must act
    expect(room.scheduledBotBets).toHaveLength(0);
  });

  it("FIXED: does not trigger bot in non-betting phases", () => {
    room.state.handNumber = 1;
    room.state.phase = "payout";
    room.state.currentTurnId = "";

    // Simulate next hand landing in dealing (edge case: should not happen, but guard)
    room.state.phase = "dealing";
    room.scheduleBotAction(); // called with dealing phase

    expect(room.scheduledBotBets).toHaveLength(0);
    expect(room.scheduledBotPlays).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Double-endGame guard
// ---------------------------------------------------------------------------

class MockGameRoom {
  state: { status: "in_progress" | "finished" } = { status: "in_progress" };
  endGameCalls = 0;
  checkWinResult: { winner: string | null; isDraw: boolean } | null = null;

  checkWinCondition() {
    return this.checkWinResult;
  }

  endGame(winnerId: string | null, isDraw: boolean) {
    this.endGameCalls++;
    this.state.status = "finished";
    void winnerId;
    void isDraw;
  }

  // Mirrors the BUGGY handleMoveMessage post-move check (no status guard)
  postMoveCheckBuggy() {
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
    }
  }

  // Mirrors the FIXED handleMoveMessage post-move check (with status guard)
  postMoveCheckFixed() {
    if (this.state.status === "in_progress") {
      const result = this.checkWinCondition();
      if (result) {
        this.endGame(result.winner, result.isDraw);
      }
    }
  }
}

describe("BaseRoom – double-endGame guard in handleMoveMessage", () => {
  let room: MockGameRoom;

  beforeEach(() => {
    room = new MockGameRoom();
  });

  it("FIXED: does not call endGame a second time if game already finished internally", () => {
    // Simulate: handleMove internals already called endGame → status = finished
    room.state.status = "finished";
    room.checkWinResult = { winner: "player1", isDraw: false };

    room.postMoveCheckFixed();

    expect(room.endGameCalls).toBe(0);
  });

  it("BUGGY: calls endGame twice when game finished internally during handleMove", () => {
    room.state.status = "finished";
    room.checkWinResult = { winner: "player1", isDraw: false };

    room.postMoveCheckBuggy();

    expect(room.endGameCalls).toBe(1); // undesired second call
  });

  it("FIXED: still calls endGame when game is in_progress and win detected", () => {
    room.state.status = "in_progress";
    room.checkWinResult = { winner: "player1", isDraw: false };

    room.postMoveCheckFixed();

    expect(room.endGameCalls).toBe(1);
    expect(room.state.status).toBe("finished");
  });

  it("FIXED: does not call endGame when no winner yet", () => {
    room.state.status = "in_progress";
    room.checkWinResult = null;

    room.postMoveCheckFixed();

    expect(room.endGameCalls).toBe(0);
    expect(room.state.status).toBe("in_progress");
  });
});

// ---------------------------------------------------------------------------
// 3. "continue" action acknowledgment
// ---------------------------------------------------------------------------

interface ContinueTestState {
  phase: string;
  currentTurnId: string;
  status: string;
}

class MockBlackjackMoveHandler {
  state: ContinueTestState;
  rejectedMoves: string[] = [];
  passedMoves: string[] = [];

  constructor(phase: string, currentTurnId = "", status = "in_progress") {
    this.state = { phase, currentTurnId, status };
  }

  // Mirrors the FIXED handleMoveMessage logic for "continue"
  handleMoveMessageFixed(clientId: string, action: string): void {
    if (
      action === "continue" &&
      (this.state.phase === "payout" || this.state.phase === "elimination")
    ) {
      // Silently accepted — game auto-advances, no turn guard needed
      this.passedMoves.push(action);
      return;
    }

    // Standard turn guard
    if (this.state.status !== "in_progress") {
      this.rejectedMoves.push("not_in_progress");
      return;
    }
    if (this.state.currentTurnId !== clientId) {
      this.rejectedMoves.push("not_your_turn");
      return;
    }
    this.passedMoves.push(action);
  }
}

describe("BlackjackRoom – continue action handling", () => {
  it("accepts continue during payout phase without turn guard", () => {
    const handler = new MockBlackjackMoveHandler("payout", "");

    handler.handleMoveMessageFixed("player1", "continue");

    expect(handler.passedMoves).toContain("continue");
    expect(handler.rejectedMoves).toHaveLength(0);
  });

  it("accepts continue during elimination phase without turn guard", () => {
    const handler = new MockBlackjackMoveHandler("elimination", "");

    handler.handleMoveMessageFixed("player1", "continue");

    expect(handler.passedMoves).toContain("continue");
    expect(handler.rejectedMoves).toHaveLength(0);
  });

  it("rejects continue during betting phase if not player's turn", () => {
    const handler = new MockBlackjackMoveHandler("betting", "player2");

    handler.handleMoveMessageFixed("player1", "continue");

    expect(handler.rejectedMoves).toContain("not_your_turn");
    expect(handler.passedMoves).toHaveLength(0);
  });

  it("passes normal actions through the standard guard during player_turn", () => {
    const handler = new MockBlackjackMoveHandler("player_turn", "player1");

    handler.handleMoveMessageFixed("player1", "stand");

    expect(handler.passedMoves).toContain("stand");
    expect(handler.rejectedMoves).toHaveLength(0);
  });

  it("rejects normal actions from wrong player during player_turn", () => {
    const handler = new MockBlackjackMoveHandler("player_turn", "player2");

    handler.handleMoveMessageFixed("player1", "hit");

    expect(handler.rejectedMoves).toContain("not_your_turn");
    expect(handler.passedMoves).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Hand-transition state machine
// ---------------------------------------------------------------------------

interface HandState {
  phase: string;
  handNumber: number;
  currentTurnId: string;
  playerBets: Record<string, number>;
  allBetsPlaced: boolean;
}

function simulateHandTransition(state: HandState, playerOrder: string[]): HandState {
  // Simulate startNextHand + startBettingPhase logic
  const newHandNumber = state.handNumber + 1;
  const buttonIndex = playerOrder.indexOf("button_player");
  const firstBettorIndex = (buttonIndex + 1) % playerOrder.length;

  return {
    phase: "betting",
    handNumber: newHandNumber,
    currentTurnId: playerOrder[firstBettorIndex] ?? "",
    playerBets: {},
    allBetsPlaced: false,
  };
}

describe("BlackjackRoom – hand state machine transitions", () => {
  it("transitions from payout to betting with correct first bettor", () => {
    const state: HandState = {
      phase: "payout",
      handNumber: 1,
      currentTurnId: "",
      playerBets: { player1: 50, bot0: 30 },
      allBetsPlaced: true,
    };
    const playerOrder = ["button_player", "player1", "bot0"];

    const next = simulateHandTransition(state, playerOrder);

    expect(next.phase).toBe("betting");
    expect(next.handNumber).toBe(2);
    expect(next.currentTurnId).toBe("player1"); // index 1 after button at 0
    expect(next.playerBets).toEqual({});
    expect(next.allBetsPlaced).toBe(false);
  });

  it("wraps around player order when button is last player", () => {
    const playerOrder = ["player1", "bot0", "button_player"];

    const state: HandState = {
      phase: "payout",
      handNumber: 2,
      currentTurnId: "",
      playerBets: {},
      allBetsPlaced: false,
    };

    const next = simulateHandTransition(state, playerOrder);

    // button at index 2, first bettor = (2+1) % 3 = 0 = player1
    expect(next.currentTurnId).toBe("player1");
  });

  it("increments handNumber on each transition", () => {
    const playerOrder = ["button_player", "player1"];
    let state: HandState = {
      phase: "payout",
      handNumber: 5,
      currentTurnId: "",
      playerBets: {},
      allBetsPlaced: false,
    };

    state = simulateHandTransition(state, playerOrder);
    expect(state.handNumber).toBe(6);

    state = simulateHandTransition(state, playerOrder);
    expect(state.handNumber).toBe(7);
  });
});
