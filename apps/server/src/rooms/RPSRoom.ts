import { Client, Delayed } from "@colyseus/core";
import { RPSState } from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

type Choice = "rock" | "paper" | "scissors";

interface MoveData {
  choice: Choice;
}

const VALID_CHOICES: Choice[] = ["rock", "paper", "scissors"];
const COMMIT_TIME_LIMIT = 10000; // 10 seconds to make a choice
const REVEAL_DELAY = 800; // faster reveal
const NEXT_ROUND_DELAY = 1200; // faster next round

export class RPSRoom extends BaseRoom<RPSState> {
  maxClients = 2;
  private commitTimer: Delayed | null = null;

  initializeGame(): void {
    this.setState(new RPSState());
    this.state.status = "waiting";
    this.state.roundNumber = 1;
    this.state.targetScore = 3; // Play exactly 3 rounds
    this.state.phase = "commit";
  }

  onJoin(client: Client, options: JoinOptions): void {
    super.onJoin(client, options);

    // Assign player roles
    const playerCount = this.state.players.size;
    if (playerCount === 1) {
      this.state.player1Id = client.sessionId;
    } else if (playerCount === 2) {
      this.state.player2Id = client.sessionId;
    }
  }

  // Override startGame to set phase correctly and start commit timer
  protected startGame(): void {
    this.state.status = "in_progress";
    this.state.phase = "commit";
    this.state.currentTurnId = ""; // Both players act simultaneously in RPS
    this.state.turnStartedAt = Date.now();

    logger.info({ roomId: this.roomId }, "RPS Game started");
    this.broadcast("game_started", {});

    // Start commit timer
    this.startCommitTimer();
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as MoveData;
    const choice = moveData.choice?.toLowerCase() as Choice;

    // Validate choice
    if (!VALID_CHOICES.includes(choice)) {
      client.send("error", { message: "Invalid choice. Use rock, paper, or scissors." });
      return;
    }

    // Commit phase - both players submit choices
    if (this.state.phase !== "commit") {
      client.send("error", { message: "Not in commit phase" });
      return;
    }

    // Store the choice (hidden from other player)
    if (client.sessionId === this.state.player1Id) {
      if (this.state.player1Committed) {
        client.send("error", { message: "Already committed" });
        return;
      }
      this.state.player1Choice = choice;
      this.state.player1Committed = true;
    } else if (client.sessionId === this.state.player2Id) {
      if (this.state.player2Committed) {
        client.send("error", { message: "Already committed" });
        return;
      }
      this.state.player2Choice = choice;
      this.state.player2Committed = true;
    }

    logger.info({ roomId: this.roomId, playerId: client.sessionId }, "Player committed choice");

    // Notify that player has committed (but not what they chose)
    this.broadcast("player_committed", { playerId: client.sessionId });

    // Check if both players have committed
    if (this.state.player1Committed && this.state.player2Committed) {
      this.clearCommitTimer();
      this.revealChoices();
    }
  }

  // Override the base message handler to allow simultaneous moves
  protected override async handleMoveMessage(client: Client, data: unknown): Promise<void> {
    if (this.state.status !== "in_progress") {
      client.send("error", { message: "Game is not in progress" });
      return;
    }

    // RPS allows both players to move simultaneously, skip turn check
    this.handleMove(client, data);
  }

  private startCommitTimer(): void {
    this.clearCommitTimer();

    this.commitTimer = this.clock.setTimeout(() => {
      this.handleCommitTimeout();
    }, COMMIT_TIME_LIMIT);
  }

  private clearCommitTimer(): void {
    if (this.commitTimer) {
      this.commitTimer.clear();
      this.commitTimer = null;
    }
  }

  private handleCommitTimeout(): void {
    if (this.state.status !== "in_progress" || this.state.phase !== "commit") {
      return;
    }

    logger.info({ roomId: this.roomId }, "Commit timeout");

    // If neither player committed, it's a draw for this round
    if (!this.state.player1Committed && !this.state.player2Committed) {
      // Both players timed out - treat as draw, replay current round
      this.state.phase = "result";
      this.state.roundWinnerId = "";

      this.broadcast("timeout", { message: "Both players timed out!" });

      // Check for game end or replay current round
      const winCondition = this.checkWinCondition();
      if (winCondition) {
        this.endGame(winCondition.winner, winCondition.isDraw);
      } else {
        this.clock.setTimeout(() => {
          this.replayCurrentRound();
        }, NEXT_ROUND_DELAY);
      }
      return;
    }

    // If only one player committed, assign random choice to the other
    if (!this.state.player1Committed) {
      this.state.player1Choice = this.getRandomChoice();
      this.state.player1Committed = true;
      this.broadcast("auto_choice", { playerId: this.state.player1Id });
    }

    if (!this.state.player2Committed) {
      this.state.player2Choice = this.getRandomChoice();
      this.state.player2Committed = true;
      this.broadcast("auto_choice", { playerId: this.state.player2Id });
    }

    // Now reveal
    this.revealChoices();
  }

  private getRandomChoice(): Choice {
    return VALID_CHOICES[Math.floor(Math.random() * VALID_CHOICES.length)];
  }

  private revealChoices(): void {
    this.state.phase = "reveal";

    // Broadcast both choices
    this.broadcast("choices_revealed", {
      player1Choice: this.state.player1Choice,
      player2Choice: this.state.player2Choice,
    });

    // Determine round winner after a short delay
    this.clock.setTimeout(() => {
      this.resolveRound();
    }, REVEAL_DELAY);
  }

  private resolveRound(): void {
    const winner = this.determineRoundWinner(
      this.state.player1Choice as Choice,
      this.state.player2Choice as Choice
    );

    this.state.phase = "result";
    this.state.roundWinnerId = winner;

    if (winner === this.state.player1Id) {
      this.state.player1Score++;
    } else if (winner === this.state.player2Id) {
      this.state.player2Score++;
    }

    const isDraw = !winner;
    logger.info(
      {
        roomId: this.roomId,
        round: this.state.roundNumber,
        player1Choice: this.state.player1Choice,
        player2Choice: this.state.player2Choice,
        winner,
        isDraw,
        player1Score: this.state.player1Score,
        player2Score: this.state.player2Score,
        willAdvanceRound: !!winner,
      },
      isDraw
        ? "Round DRAW - will replay same round"
        : "Round completed - will advance to next round"
    );

    this.broadcast("round_result", {
      roundNumber: this.state.roundNumber,
      winner,
      player1Score: this.state.player1Score,
      player2Score: this.state.player2Score,
    });

    // Check for game winner
    const winCondition = this.checkWinCondition();
    if (winCondition) {
      this.endGame(winCondition.winner, winCondition.isDraw);
    } else {
      // Prepare next round after delay
      this.clock.setTimeout(() => {
        if (winner) {
          // Only advance round on actual wins
          this.startNextRound();
        } else {
          // Replay same round on draws
          this.replayCurrentRound();
        }
      }, NEXT_ROUND_DELAY);
    }
  }

  private determineRoundWinner(choice1: Choice, choice2: Choice): string {
    if (choice1 === choice2) {
      return ""; // Draw
    }

    const wins: Record<Choice, Choice> = {
      rock: "scissors",
      paper: "rock",
      scissors: "paper",
    };

    if (wins[choice1] === choice2) {
      return this.state.player1Id;
    }
    return this.state.player2Id;
  }

  private startNextRound(): void {
    this.state.roundNumber++;
    this.state.phase = "commit";
    this.state.player1Choice = "";
    this.state.player2Choice = "";
    this.state.player1Committed = false;
    this.state.player2Committed = false;
    this.state.roundWinnerId = "";
    this.state.turnStartedAt = Date.now();

    this.broadcast("round_started", { roundNumber: this.state.roundNumber });

    // Start new commit timer
    this.startCommitTimer();
  }

  private replayCurrentRound(): void {
    this.state.phase = "commit";
    this.state.player1Choice = "";
    this.state.player2Choice = "";
    this.state.player1Committed = false;
    this.state.player2Committed = false;
    this.state.roundWinnerId = "";
    this.state.turnStartedAt = Date.now();

    this.broadcast("round_replay", { roundNumber: this.state.roundNumber });

    // Start new commit timer for the same round
    this.startCommitTimer();
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    // Check if either player has reached the target score (first to 3)
    if (this.state.player1Score >= this.state.targetScore) {
      return { winner: this.state.player1Id, isDraw: false };
    }
    if (this.state.player2Score >= this.state.targetScore) {
      return { winner: this.state.player2Id, isDraw: false };
    }

    // Prevent infinite games - fallback at round 20 (unlikely to reach with draws)
    if (this.state.roundNumber >= 20) {
      if (this.state.player1Score > this.state.player2Score) {
        return { winner: this.state.player1Id, isDraw: false };
      } else if (this.state.player2Score > this.state.player1Score) {
        return { winner: this.state.player2Id, isDraw: false };
      } else {
        return { winner: null, isDraw: true };
      }
    }

    return null;
  }

  async onDispose(): Promise<void> {
    this.clearCommitTimer();
    await super.onDispose();
  }
}
