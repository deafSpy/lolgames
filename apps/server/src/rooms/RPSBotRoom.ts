import { Client, Delayed } from "@colyseus/core";
import { RPSState, GamePlayerSchema } from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { RPSBot } from "../bots/RPSBot.js";
import { logger } from "../logger.js";

type Choice = "rock" | "paper" | "scissors";

interface MoveData {
  choice: Choice;
}

const VALID_CHOICES: Choice[] = ["rock", "paper", "scissors"];
const REVEAL_DELAY = 800;
const NEXT_ROUND_DELAY = 1200;

export class RPSBotRoom extends BaseRoom<RPSState> {
  maxClients = 1; // Only one human player
  private bot: RPSBot | null = null;
  private botPlayerId = "bot_rps";
  private revealTimer: Delayed | null = null;

  initializeGame(): void {
    this.setState(new RPSState());
    this.state.status = "waiting";
    this.state.roundNumber = 1;
    this.state.targetScore = 3;
    this.state.phase = "commit";
  }

  onJoin(client: Client, options: JoinOptions): void {
    super.onJoin(client, options);

    // Human is always player 1
    this.state.player1Id = client.sessionId;

    // Create bot as player 2
    const botPlayer = new GamePlayerSchema();
    botPlayer.id = this.botPlayerId;
    botPlayer.displayName = "RPS Bot";
    botPlayer.isReady = true;
    botPlayer.isConnected = true;
    botPlayer.joinedAt = Date.now();
    botPlayer.isBot = true;
    this.state.players.set(this.botPlayerId, botPlayer);
    this.state.player2Id = this.botPlayerId;
    // Add bot to initial players for turn rotation
    this.initialPlayers.add(this.botPlayerId);
    this.registerBotIdentity(this.botPlayerId, botPlayer.displayName);

    // Initialize bot - no difficulty options for RPS
    this.bot = new RPSBot(this.botPlayerId);

    logger.info({ roomId: this.roomId }, "Bot created for RPS");
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;

    // Only need human player to be ready
    const humanPlayer = Array.from(this.state.players.values()).find(
      (p) => p.id !== this.botPlayerId
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    this.state.status = "in_progress";
    this.state.phase = "commit";
    this.state.currentTurnId = "";
    this.state.turnStartedAt = Date.now();

    logger.info({ roomId: this.roomId }, "RPS Bot Game started");
    this.broadcast("game_started", {});

    // Bot makes its choice immediately (hidden)
    this.scheduleBotChoice();
  }

  private async scheduleBotChoice(): Promise<void> {
    if (!this.bot || this.state.status !== "in_progress") return;
    if (this.state.phase !== "commit") return;

    try {
      const move = (await this.bot.getMove({
        roundNumber: this.state.roundNumber,
        player1Id: this.state.player1Id,
        player2Id: this.state.player2Id,
        player1Choice: this.state.player1Choice,
        player2Choice: this.state.player2Choice,
        phase: this.state.phase,
      })) as { choice: Choice };

      // Store bot choice but don't reveal
      this.state.player2Choice = move.choice;
      this.state.player2Committed = true;

      // Check if human has also committed
      if (this.state.player1Committed) {
        this.revealChoices();
      }
    } catch (error) {
      logger.error(error, "Bot choice failed");
    }
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as MoveData;
    const choice = moveData.choice?.toLowerCase() as Choice;

    if (!VALID_CHOICES.includes(choice)) {
      client.send("error", { message: "Invalid choice" });
      return;
    }

    if (this.state.phase !== "commit") {
      client.send("error", { message: "Not in commit phase" });
      return;
    }

    if (this.state.player1Committed) {
      client.send("error", { message: "Already committed" });
      return;
    }

    this.state.player1Choice = choice;
    this.state.player1Committed = true;

    logger.info({ roomId: this.roomId, choice }, "Human committed choice");

    this.broadcast("player_committed", { playerId: client.sessionId });

    // Check if bot has also committed
    if (this.state.player2Committed) {
      this.revealChoices();
    }
  }

  protected override async handleMoveMessage(client: Client, data: unknown): Promise<void> {
    if (this.state.status !== "in_progress") {
      client.send("error", { message: "Game is not in progress" });
      return;
    }

    this.handleMove(client, data);
  }

  private revealChoices(): void {
    this.state.phase = "reveal";

    this.broadcast("choices_revealed", {
      player1Choice: this.state.player1Choice,
      player2Choice: this.state.player2Choice,
    });

    // Record for bot learning
    if (this.bot) {
      this.bot.recordOpponentChoice(
        this.state.player1Choice as Choice,
        this.state.player2Choice as Choice
      );
    }

    // Resolve after delay
    this.revealTimer = this.clock.setTimeout(() => {
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
    if (choice1 === choice2) return "";

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

    // Bot makes choice for new round
    this.scheduleBotChoice();
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

    // Bot makes choice for replayed round
    this.scheduleBotChoice();
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    const winsNeeded = this.state.targetScore;

    if (this.state.player1Score >= winsNeeded) {
      return { winner: this.state.player1Id, isDraw: false };
    }
    if (this.state.player2Score >= winsNeeded) {
      return { winner: this.state.player2Id, isDraw: false };
    }

    const roundsPlayed = this.state.roundNumber;
    const roundsRemaining = 2 * this.state.targetScore - roundsPlayed;

    if (
      this.state.player1Score + roundsRemaining < winsNeeded &&
      this.state.player2Score + roundsRemaining < winsNeeded
    ) {
      return { winner: null, isDraw: true };
    }

    return null;
  }

  async onDispose(): Promise<void> {
    if (this.revealTimer) {
      this.revealTimer.clear();
    }
    await super.onDispose();
  }
}
