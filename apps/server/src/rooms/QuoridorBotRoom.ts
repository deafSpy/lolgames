import { Client } from "@colyseus/core";
import { QuoridorPlayer, QuoridorWall } from "@multiplayer/shared";
import { QuoridorRoom } from "./QuoridorRoom.js";
import { logger } from "../logger.js";

type Difficulty = "easy" | "medium" | "hard";

interface Position {
  x: number;
  y: number;
}

/**
 * Quoridor bot room with adjustable difficulty levels.
 * - Easy: Random valid moves
 * - Medium: Simple forward motion toward goal
 * - Hard: A* pathfinding + strategic wall placement
 */
export class QuoridorBotRoom extends QuoridorRoom {
  maxClients = 1; // single human + bot
  private botId = "quoridor_bot";
  private difficulty: Difficulty = "hard";

  onCreate(options: {
    playerName?: string;
    hostName?: string;
    createdAt?: number;
    vsBot?: boolean;
    difficulty?: Difficulty;
  }): void {
    super.onCreate(options);
    this.difficulty = options.difficulty || this.difficulty;
    logger.info({ roomId: this.roomId, difficulty: this.difficulty }, "Quoridor bot room created");
  }

  onJoin(
    client: Client,
    options: {
      playerName?: string;
      hostName?: string;
      createdAt?: number;
      vsBot?: boolean;
      difficulty?: Difficulty;
    }
  ): void {
    // Call base join for human first
    super.onJoin(client, options);

    // If bot not added yet, add as player 2
    if (!this.state.players.get(this.botId)) {
      const bot = new QuoridorPlayer();
      bot.id = this.botId;
      bot.displayName = this.getBotName();
      bot.isReady = true;
      bot.isConnected = true;
      bot.joinedAt = Date.now();
      bot.isBot = true;
      bot.wallsRemaining = 10;
      // Bot starts at top, goal at bottom
      bot.x = 4;
      bot.y = 0;
      bot.goalRow = 8;
      this.state.players.set(this.botId, bot);

      // Add bot to initial players for turn rotation
      this.initialPlayers.add(this.botId);
      this.registerBotIdentity(this.botId, bot.displayName);

      // Ensure human player is also in initialPlayers (should be added by super.onJoin)
      if (!this.initialPlayers.has(client.sessionId)) {
        this.initialPlayers.add(client.sessionId);
        logger.warn(
          { roomId: this.roomId, playerId: client.sessionId },
          "Human player was not in initialPlayers, adding manually"
        );
      }

      logger.info(
        {
          roomId: this.roomId,
          humanPlayer: client.sessionId,
          botPlayer: this.botId,
          initialPlayers: Array.from(this.initialPlayers),
          allPlayers: Array.from(this.state.players.keys()),
        },
        "Bot added to Quoridor room"
      );
    }
  }

  private getBotName(): string {
    switch (this.difficulty) {
      case "easy":
        return "QuoriBot (Easy)";
      case "medium":
        return "QuoriBot (Medium)";
      case "hard":
        return "QuoriBot (Hard)";
      default:
        return "QuoriBot";
    }
  }

  protected checkStartGame(): void {
    // Auto-ready bot; start when human readies
    if (this.state.status !== "waiting") return;
    if (this.clients.length < 1) return;
    const allReady = Array.from(this.state.players.values()).every((p) => p.isReady);
    if (allReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();
    // If bot goes first, make its move immediately
    if (this.state.currentTurnId === this.botId) {
      this.scheduleBotMove();
    }
  }

  handleMove(client: Client, data: unknown): void {
    super.handleMove(client, data);
    // After human move, if it's bot's turn, make a move
    this.scheduleBotMove();
  }

  private scheduleBotMove(): void {
    if (this.state.status !== "in_progress") return;
    if (this.state.currentTurnId !== this.botId) return;
    const bot = this.state.players.get(this.botId) as QuoridorPlayer | undefined;
    if (!bot) return;

    // For debugging, make bot moves synchronous with a small delay
    const delay = 100; // Very short delay for testing

    this.clock.setTimeout(() => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== this.botId) return;

      logger.info(
        { roomId: this.roomId, botId: this.botId, currentTurnId: this.state.currentTurnId },
        "Bot making move"
      );

      const action = this.chooseBotAction(bot);

      if (action.type === "move") {
        // Apply move directly
        bot.x = action.x;
        bot.y = action.y;
        logger.info(
          { roomId: this.roomId, botId: this.botId, x: action.x, y: action.y },
          "Bot moved pawn"
        );
        this.broadcast("pawn_moved", { playerId: this.botId, x: action.x, y: action.y });
      } else if (action.type === "wall") {
        // Place wall
        const wall = new QuoridorWall();
        wall.x = action.x;
        wall.y = action.y;
        wall.orientation = action.orientation;
        this.state.walls.push(wall);
        bot.wallsRemaining--;
        logger.info(
          {
            roomId: this.roomId,
            botId: this.botId,
            x: action.x,
            y: action.y,
            orientation: action.orientation,
          },
          "Bot placed wall"
        );
        this.broadcast("wall_placed", {
          playerId: this.botId,
          x: action.x,
          y: action.y,
          orientation: action.orientation,
        });
      }

      const result = this.checkWinCondition();
      if (result) {
        this.endGame(result.winner, result.isDraw);
        return;
      }

      logger.info(
        { roomId: this.roomId, botId: this.botId, nextTurn: true },
        "Bot turn completed, advancing to next turn"
      );
      this.nextTurn();
    }, delay);
  }

  private chooseBotAction(
    bot: QuoridorPlayer
  ):
    | { type: "move"; x: number; y: number }
    | { type: "wall"; x: number; y: number; orientation: "horizontal" | "vertical" } {
    switch (this.difficulty) {
      case "easy":
        return this.easyAI(bot);
      case "medium":
        return this.mediumAI(bot);
      case "hard":
        return this.hardAI(bot);
      default:
        return this.mediumAI(bot);
    }
  }

  /**
   * Easy AI: Random valid pawn moves, no wall placement
   */
  private easyAI(bot: QuoridorPlayer): { type: "move"; x: number; y: number } {
    const moves = this.getValidPawnMoves(bot);
    if (moves.length === 0) {
      // Fallback: stay in place (shouldn't happen)
      return { type: "move", x: bot.x, y: bot.y };
    }
    // Random move
    const move = moves[Math.floor(Math.random() * moves.length)];
    return { type: "move", x: move.x, y: move.y };
  }

  /**
   * Medium AI: Move toward goal using shortest path, no walls
   */
  private mediumAI(bot: QuoridorPlayer): { type: "move"; x: number; y: number } {
    const moves = this.getValidPawnMoves(bot);
    if (moves.length === 0) {
      return { type: "move", x: bot.x, y: bot.y };
    }

    // Find move that gets closest to goal
    let bestMove = moves[0];
    let bestDist = this.getShortestPathLength(moves[0].x, moves[0].y, bot.goalRow);

    for (const move of moves) {
      const dist = this.getShortestPathLength(move.x, move.y, bot.goalRow);
      if (dist < bestDist) {
        bestDist = dist;
        bestMove = move;
      }
    }

    return { type: "move", x: bestMove.x, y: bestMove.y };
  }

  /**
   * Hard AI: A* pathfinding + strategic wall placement
   */
  private hardAI(
    bot: QuoridorPlayer
  ):
    | { type: "move"; x: number; y: number }
    | { type: "wall"; x: number; y: number; orientation: "horizontal" | "vertical" } {
    const opponent = this.getOpponent(bot.id) as QuoridorPlayer | null;
    if (!opponent) {
      return this.mediumAI(bot);
    }

    const myPath = this.getShortestPathLength(bot.x, bot.y, bot.goalRow);
    const oppPath = this.getShortestPathLength(opponent.x, opponent.y, opponent.goalRow);

    // If we're winning on path length or low on walls, just move
    if (bot.wallsRemaining <= 1 || myPath <= oppPath) {
      return this.mediumAI(bot);
    }

    // Try to place a wall to slow down opponent
    if (bot.wallsRemaining > 0 && Math.random() < 0.85) {
      const wallAction = this.findBestWall(bot, opponent);
      if (wallAction) {
        return wallAction;
      }
    }

    // Otherwise, move
    return this.mediumAI(bot);
  }

  private getValidPawnMoves(player: QuoridorPlayer): Position[] {
    const moves: Position[] = [];
    const opponent = this.getOpponent(player.id) as QuoridorPlayer | null;
    const oppPos = opponent ? { x: opponent.x, y: opponent.y } : null;

    const deltas = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];

    for (const { dx, dy } of deltas) {
      const nx = player.x + dx;
      const ny = player.y + dy;
      if (nx < 0 || nx >= this.state.boardSize || ny < 0 || ny >= this.state.boardSize) continue;
      if (this.isValidPawnMove(player.x, player.y, nx, ny, oppPos)) {
        moves.push({ x: nx, y: ny });
      }
    }

    // Jump moves (2 squares if opponent in between)
    if (oppPos) {
      const jumpDeltas = [
        { dx: 0, dy: -2 },
        { dx: 0, dy: 2 },
        { dx: -2, dy: 0 },
        { dx: 2, dy: 0 },
      ];
      for (const { dx, dy } of jumpDeltas) {
        const nx = player.x + dx;
        const ny = player.y + dy;
        if (nx < 0 || nx >= this.state.boardSize || ny < 0 || ny >= this.state.boardSize) continue;
        if (this.isValidPawnMove(player.x, player.y, nx, ny, oppPos)) {
          moves.push({ x: nx, y: ny });
        }
      }
    }

    return moves;
  }

  private getShortestPathLength(startX: number, startY: number, goalRow: number): number {
    // BFS to find shortest path
    const visited = new Set<string>();
    const queue: { x: number; y: number; dist: number }[] = [{ x: startX, y: startY, dist: 0 }];
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.y === goalRow) {
        return current.dist;
      }

      const neighbors = [
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
      ];

      for (const neighbor of neighbors) {
        if (
          neighbor.x < 0 ||
          neighbor.x >= this.state.boardSize ||
          neighbor.y < 0 ||
          neighbor.y >= this.state.boardSize
        ) {
          continue;
        }

        const key = `${neighbor.x},${neighbor.y}`;
        if (visited.has(key)) continue;

        if (this.isWallBlockingPath(current.x, current.y, neighbor.x, neighbor.y)) {
          continue;
        }

        visited.add(key);
        queue.push({ x: neighbor.x, y: neighbor.y, dist: current.dist + 1 });
      }
    }

    return Infinity; // No path found
  }

  private isWallBlockingPath(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;

    for (const wall of this.state.walls) {
      if (wall.orientation === "horizontal") {
        if (dy !== 0) {
          const minY = Math.min(fromY, toY);
          if (wall.y === minY) {
            if (fromX >= wall.x && fromX <= wall.x + 1) {
              return true;
            }
          }
        }
      } else {
        if (dx !== 0) {
          const minX = Math.min(fromX, toX);
          if (wall.x === minX) {
            if (fromY >= wall.y && fromY <= wall.y + 1) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  private findBestWall(
    bot: QuoridorPlayer,
    opponent: QuoridorPlayer
  ): { type: "wall"; x: number; y: number; orientation: "horizontal" | "vertical" } | null {
    let bestWall: { x: number; y: number; orientation: "horizontal" | "vertical" } | null = null;
    let bestIncrease = 0;

    const currentOppPath = this.getShortestPathLength(opponent.x, opponent.y, opponent.goalRow);

    // Try walls near opponent
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const wx = opponent.x + dx;
        const wy = opponent.y + dy;
        if (wx < 0 || wx >= this.state.boardSize - 1 || wy < 0 || wy >= this.state.boardSize - 1)
          continue;

        for (const orientation of ["horizontal", "vertical"] as const) {
          if (this.isWallPlacementValid(wx, wy, orientation)) {
            // Temporarily add wall
            const tempWall = new QuoridorWall();
            tempWall.x = wx;
            tempWall.y = wy;
            tempWall.orientation = orientation;
            this.state.walls.push(tempWall);

            // Check if paths are still valid
            const myNewPath = this.getShortestPathLength(bot.x, bot.y, bot.goalRow);
            const oppNewPath = this.getShortestPathLength(opponent.x, opponent.y, opponent.goalRow);

            // Remove temp wall
            this.state.walls.pop();

            // Wall is good if it increases opponent's path more than ours
            if (oppNewPath < Infinity && myNewPath < Infinity) {
              const increase =
                oppNewPath -
                currentOppPath -
                (myNewPath - this.getShortestPathLength(bot.x, bot.y, bot.goalRow));
              if (increase > bestIncrease) {
                bestIncrease = increase;
                bestWall = { x: wx, y: wy, orientation };
              }
            }
          }
        }
      }
    }

    if (bestWall && bestIncrease >= 1) {
      return { type: "wall", ...bestWall };
    }

    return null;
  }

  private isWallPlacementValid(
    x: number,
    y: number,
    orientation: "horizontal" | "vertical"
  ): boolean {
    // Check bounds
    if (x < 0 || x >= this.state.boardSize - 1 || y < 0 || y >= this.state.boardSize - 1) {
      return false;
    }

    // Check for collisions
    for (const wall of this.state.walls) {
      if (
        this.wallsCollide(
          x,
          y,
          orientation,
          wall.x,
          wall.y,
          wall.orientation as "horizontal" | "vertical"
        )
      ) {
        return false;
      }
    }

    // Check paths remain valid
    const tempWall = new QuoridorWall();
    tempWall.x = x;
    tempWall.y = y;
    tempWall.orientation = orientation;
    this.state.walls.push(tempWall);

    let valid = true;
    for (const [, player] of this.state.players) {
      const p = player as QuoridorPlayer;
      if (this.getShortestPathLength(p.x, p.y, p.goalRow) === Infinity) {
        valid = false;
        break;
      }
    }

    this.state.walls.pop();
    return valid;
  }

  protected wallsCollide(
    x1: number,
    y1: number,
    o1: "horizontal" | "vertical",
    x2: number,
    y2: number,
    o2: "horizontal" | "vertical"
  ): boolean {
    if (x1 === x2 && y1 === y2) return true;
    if (o1 === o2) {
      if (o1 === "horizontal" && y1 === y2 && Math.abs(x1 - x2) === 1) return true;
      if (o1 === "vertical" && x1 === x2 && Math.abs(y1 - y2) === 1) return true;
    }
    return false;
  }
}
