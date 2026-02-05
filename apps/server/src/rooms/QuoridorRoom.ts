import { Client } from "@colyseus/core";
import { QuoridorState, QuoridorPlayer, QuoridorWall } from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

interface MoveData {
  type: "move" | "wall";
  x: number;
  y: number;
  orientation?: "horizontal" | "vertical";
}

interface Position {
  x: number;
  y: number;
}

export class QuoridorRoom extends BaseRoom<QuoridorState> {
  maxClients = 2;

  initializeGame(): void {
    this.setState(new QuoridorState());
    this.state.status = "waiting";
    this.state.boardSize = 9;
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new QuoridorPlayer();
    player.id = client.sessionId;
    player.displayName = options.playerName || `Guest_${client.sessionId.slice(0, 4)}`;
    player.isReady = false;
    player.isConnected = true;
    player.joinedAt = Date.now();
    player.wallsRemaining = 10;

    const playerCount = this.state.players.size;
    if (playerCount === 0) {
      // Player 1 starts at bottom (row 8), needs to reach top (row 0)
      player.x = 4;
      player.y = 8;
      player.goalRow = 0;
    } else {
      // Player 2 starts at top (row 0), needs to reach bottom (row 8)
      player.x = 4;
      player.y = 0;
      player.goalRow = 8;
    }

    this.state.players.set(client.sessionId, player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, playerName: player.displayName },
      "Player joined Quoridor"
    );

    if (this.clients.length >= this.maxClients) {
      this.lock();
    }
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as MoveData;
    const player = this.state.players.get(client.sessionId) as QuoridorPlayer;

    logger.info({
      roomId: this.roomId,
      playerId: client.sessionId,
      currentTurnId: this.state.currentTurnId,
      moveType: moveData.type,
      x: moveData.x,
      y: moveData.y,
      orientation: moveData.orientation,
      players: Array.from(this.state.players.values()).map(p => ({ id: p.id, displayName: p.displayName, isBot: p.isBot }))
    }, "Quoridor move received");

    if (!player) {
      client.send("error", { message: "Player not found" });
      return;
    }

    if (moveData.type === "move") {
      this.handlePawnMove(client, player, moveData.x, moveData.y);
    } else if (moveData.type === "wall") {
      this.handleWallPlace(client, player, moveData.x, moveData.y, moveData.orientation || "horizontal");
    } else {
      client.send("error", { message: "Invalid move type" });
    }
  }

  private handlePawnMove(client: Client, player: QuoridorPlayer, x: number, y: number): void {
    // Validate move is within bounds
    if (x < 0 || x >= this.state.boardSize || y < 0 || y >= this.state.boardSize) {
      client.send("error", { message: "Move out of bounds" });
      return;
    }

    // Get opponent position
    const opponent = this.getOpponent(client.sessionId);
    const opponentPos = opponent ? { x: opponent.x, y: opponent.y } : null;

    // Validate move is legal
    if (!this.isValidPawnMove(player.x, player.y, x, y, opponentPos)) {
      client.send("error", { message: "Invalid move" });
      return;
    }

    // Execute move
    player.x = x;
    player.y = y;

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, x, y },
      "Pawn moved"
    );

    this.broadcast("pawn_moved", { playerId: client.sessionId, x, y });

    // Check for win
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }

    this.nextTurn();
  }

  protected isValidPawnMove(fromX: number, fromY: number, toX: number, toY: number, opponentPos: Position | null): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Simple adjacent move
    if ((absDx === 1 && absDy === 0) || (absDx === 0 && absDy === 1)) {
      // Check if blocked by wall
      if (this.isWallBlocking(fromX, fromY, toX, toY)) {
        return false;
      }
      // Check if opponent is there
      if (opponentPos && opponentPos.x === toX && opponentPos.y === toY) {
        return false;
      }
      return true;
    }

    // Jump over opponent (straight)
    if ((absDx === 2 && absDy === 0) || (absDx === 0 && absDy === 2)) {
      // Opponent must be in the middle
      const midX = fromX + dx / 2;
      const midY = fromY + dy / 2;
      if (!opponentPos || opponentPos.x !== midX || opponentPos.y !== midY) {
        return false;
      }
      // Check walls don't block the jump
      if (this.isWallBlocking(fromX, fromY, midX, midY)) return false;
      if (this.isWallBlocking(midX, midY, toX, toY)) return false;
      return true;
    }

    // Diagonal jump (when straight jump is blocked)
    if (absDx === 1 && absDy === 1) {
      if (!opponentPos) return false;
      
      // Check if opponent is adjacent
      const oppDx = opponentPos.x - fromX;
      const oppDy = opponentPos.y - fromY;
      if (!(Math.abs(oppDx) === 1 && oppDy === 0) && !(oppDx === 0 && Math.abs(oppDy) === 1)) {
        return false;
      }
      
      // Check if there's a wall behind the opponent (or edge of board)
      const behindX = opponentPos.x + oppDx;
      const behindY = opponentPos.y + oppDy;
      const blocked = behindX < 0 || behindX >= this.state.boardSize ||
                      behindY < 0 || behindY >= this.state.boardSize ||
                      this.isWallBlocking(opponentPos.x, opponentPos.y, behindX, behindY);
      
      if (!blocked) return false;
      
      // Check if path to diagonal is not blocked
      if (this.isWallBlocking(fromX, fromY, opponentPos.x, opponentPos.y)) return false;
      if (this.isWallBlocking(opponentPos.x, opponentPos.y, toX, toY)) return false;
      
      return true;
    }

    return false;
  }

  private handleWallPlace(
    client: Client,
    player: QuoridorPlayer,
    x: number,
    y: number,
    orientation: "horizontal" | "vertical"
  ): void {
    // Check if player has walls remaining
    if (player.wallsRemaining <= 0) {
      client.send("error", { message: "No walls remaining" });
      return;
    }

    // Validate wall position (walls go between squares, so max is boardSize-2)
    if (x < 0 || x >= this.state.boardSize - 1 || y < 0 || y >= this.state.boardSize - 1) {
      client.send("error", { message: "Wall position out of bounds" });
      return;
    }

    // Check for wall collisions
    for (const wall of this.state.walls) {
      if (this.wallsCollide(x, y, orientation, wall.x, wall.y, wall.orientation as "horizontal" | "vertical")) {
        client.send("error", { message: "Wall collides with existing wall" });
        return;
      }
    }

    // Check that wall doesn't completely block any player's path to goal
    const tempWall = new QuoridorWall();
    tempWall.x = x;
    tempWall.y = y;
    tempWall.orientation = orientation;
    this.state.walls.push(tempWall);

    let pathsValid = true;
    for (const [, p] of this.state.players) {
      const qp = p as QuoridorPlayer;
      if (!this.hasPathToGoal(qp.x, qp.y, qp.goalRow)) {
        pathsValid = false;
        break;
      }
    }

    if (!pathsValid) {
      // Remove the wall we just added
      this.state.walls.pop();
      client.send("error", { message: "Wall would block a player's path to goal" });
      return;
    }

    // Wall is valid and already added
    player.wallsRemaining--;

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, x, y, orientation },
      "Wall placed"
    );

    this.broadcast("wall_placed", { playerId: client.sessionId, x, y, orientation });

    // Check for win (rare via wall, but keep flow consistent)
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }

    this.nextTurn();
  }

  private wallsCollide(
    x1: number, y1: number, o1: "horizontal" | "vertical",
    x2: number, y2: number, o2: "horizontal" | "vertical"
  ): boolean {
    // Same center position = collision
    if (x1 === x2 && y1 === y2) return true;

    // Same orientation - check if overlapping (walls span 2 squares)
    if (o1 === o2) {
      if (o1 === "horizontal" && y1 === y2 && Math.abs(x1 - x2) === 1) return true;
      if (o1 === "vertical" && x1 === x2 && Math.abs(y1 - y2) === 1) return true;
    }

    return false;
  }

  /**
   * BFS to check if there's a path from (startX, startY) to the goalRow
   */
  private hasPathToGoal(startX: number, startY: number, goalRow: number): boolean {
    const visited = new Set<string>();
    const queue: Position[] = [{ x: startX, y: startY }];
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if we reached the goal
      if (current.y === goalRow) {
        return true;
      }

      // Try all four directions
      const neighbors: Position[] = [
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
      ];

      for (const neighbor of neighbors) {
        // Check bounds
        if (neighbor.x < 0 || neighbor.x >= this.state.boardSize ||
            neighbor.y < 0 || neighbor.y >= this.state.boardSize) {
          continue;
        }

        const key = `${neighbor.x},${neighbor.y}`;
        if (visited.has(key)) continue;

        // Check if wall blocks this move
        if (this.isWallBlocking(current.x, current.y, neighbor.x, neighbor.y)) {
          continue;
        }

        visited.add(key);
        queue.push(neighbor);
      }
    }

    return false;
  }

  /**
   * Check if a wall blocks movement between two adjacent squares
   */
  private isWallBlocking(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;

    for (const wall of this.state.walls) {
      if (wall.orientation === "horizontal") {
        // Horizontal wall blocks vertical movement
        if (dy !== 0) {
          const minY = Math.min(fromY, toY);
          // Wall at (wx, wy) blocks movement between rows wy and wy+1
          if (wall.y === minY) {
            // Check if our column is covered by this wall (wall spans wx and wx+1)
            if (fromX >= wall.x && fromX <= wall.x + 1) {
              return true;
            }
          }
        }
      } else {
        // Vertical wall blocks horizontal movement
        if (dx !== 0) {
          const minX = Math.min(fromX, toX);
          // Wall at (wx, wy) blocks movement between columns wx and wx+1
          if (wall.x === minX) {
            // Check if our row is covered by this wall (wall spans wy and wy+1)
            if (fromY >= wall.y && fromY <= wall.y + 1) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  protected getOpponent(playerId: string): QuoridorPlayer | null {
    for (const [id, player] of this.state.players) {
      if (id !== playerId) {
        return player as QuoridorPlayer;
      }
    }
    return null;
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    for (const [playerId, player] of this.state.players) {
      const p = player as QuoridorPlayer;
      if (p.y === p.goalRow) {
        return { winner: playerId, isDraw: false };
      }
    }
    return null;
  }
}
