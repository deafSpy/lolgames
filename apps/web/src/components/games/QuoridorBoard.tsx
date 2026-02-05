"use client";

import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";

interface QuoridorPlayer {
  id: string;
  displayName: string;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: number;
  isBot: boolean;
  isSpectator: boolean;
  wasInitialPlayer: boolean;
  x: number;
  y: number;
  wallsRemaining: number;
  goalRow: number;
}

interface QuoridorWall {
  x: number;
  y: number;
  orientation: string;
}

interface QuoridorBoardProps {
  boardSize: number;
  players: Map<string, QuoridorPlayer>;
  walls: QuoridorWall[];
  currentTurnId: string;
  playerId: string;
  isMyTurn: boolean;
  onMove: (x: number, y: number) => void;
  onPlaceWall: (x: number, y: number, orientation: "horizontal" | "vertical") => void;
  disabled?: boolean;
  turnStartedAt?: number;
  turnTimeLimit?: number;
  winnerId?: string;
  isFinished?: boolean;
}

const CELL_SIZE = 44;
const GAP_SIZE = 8;

// Check if two walls collide (same logic as server)
function wallsCollide(
  x1: number, y1: number, o1: "horizontal" | "vertical",
  x2: number, y2: number, o2: string
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

// Check if a wall blocks movement between two adjacent squares
function isWallBlocking(
  walls: QuoridorWall[],
  fromX: number, fromY: number, toX: number, toY: number
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;

  for (const wall of walls) {
    if (wall.orientation === "horizontal") {
      // Horizontal wall blocks vertical movement
      if (dy !== 0) {
        const minY = Math.min(fromY, toY);
        if (wall.y === minY) {
          if (fromX >= wall.x && fromX <= wall.x + 1) {
            return true;
          }
        }
      }
    } else {
      // Vertical wall blocks horizontal movement
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

// BFS to check if there's a path from (startX, startY) to the goalRow
function hasPathToGoal(
  walls: QuoridorWall[],
  boardSize: number,
  startX: number, startY: number, goalRow: number
): boolean {
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.y === goalRow) {
      return true;
    }

    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= boardSize ||
          neighbor.y < 0 || neighbor.y >= boardSize) {
        continue;
      }

      const key = `${neighbor.x},${neighbor.y}`;
      if (visited.has(key)) continue;

      if (isWallBlocking(walls, current.x, current.y, neighbor.x, neighbor.y)) {
        continue;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return false;
}

export function QuoridorBoard({
  boardSize,
  players,
  walls,
  currentTurnId,
  playerId,
  isMyTurn,
  onMove,
  onPlaceWall,
  disabled = false,
  turnStartedAt = 0,
  turnTimeLimit = 30000,
  winnerId,
  isFinished = false,
}: QuoridorBoardProps) {
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [hoveredWall, setHoveredWall] = useState<{ x: number; y: number; orientation: "horizontal" | "vertical" } | null>(null);
  const [lastMoveFrom, setLastMoveFrom] = useState<{ x: number; y: number } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(turnTimeLimit);

  const playerArray = Array.from(players.values());
  const myPlayer = playerArray.find((p) => p.id === playerId);
  const opponent = playerArray.find((p) => p.id !== playerId);

  console.log("QuoridorBoard debug:", {
    playerId,
    currentTurnId,
    isMyTurn,
    playerArray: playerArray.map(p => ({ id: p.id, displayName: p.displayName, x: p.x, y: p.y, isBot: p.isBot })),
    myPlayer: myPlayer ? { id: myPlayer.id, displayName: myPlayer.displayName, x: myPlayer.x, y: myPlayer.y, isBot: myPlayer.isBot, isConnected: myPlayer.isConnected } : null,
    opponent: opponent ? { id: opponent.id, displayName: opponent.displayName, x: opponent.x, y: opponent.y, isBot: opponent.isBot, isConnected: opponent.isConnected } : null,
    disabled,
    isFinished,
    playersSize: players.size,
    canMoveChecks: {
      hasMyPlayer: !!myPlayer,
      notDisabled: !disabled,
      isMyTurn: !!isMyTurn,
      notFinished: !isFinished
    }
  });

  // Track last move position
  useEffect(() => {
    if (currentTurnId && currentTurnId !== playerId) {
      // Opponent just moved, store their previous position as lastMoveFrom
      const opponentPlayer = players.get(currentTurnId);
      if (opponentPlayer) {
        setLastMoveFrom({ x: opponentPlayer.x, y: opponentPlayer.y });
      }
    }
  }, [currentTurnId, playerId, players]);

  // Timer effect - update every second
  useEffect(() => {
    if (!turnStartedAt || disabled) {
      setTimeRemaining(turnTimeLimit);
      return;
    }

    const updateTimer = () => {
      const elapsed = Date.now() - turnStartedAt;
      const remaining = Math.max(0, turnTimeLimit - elapsed);
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [turnStartedAt, turnTimeLimit, disabled]);

  // Format time for display
  const formatTime = (ms: number): string => {
    const seconds = Math.ceil(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  };

  const isTimeLow = timeRemaining <= 10000; // Last 10 seconds

  // Check if a wall placement is valid (client-side validation matching server logic)
  const isWallPlacementValid = useCallback((x: number, y: number, orientation: "horizontal" | "vertical"): boolean => {
    // Check bounds
    if (x < 0 || x >= boardSize - 1 || y < 0 || y >= boardSize - 1) {
      return false;
    }

    // Check for collisions with existing walls
    for (const wall of walls) {
      if (wallsCollide(x, y, orientation, wall.x, wall.y, wall.orientation)) {
        return false;
      }
    }

    // Check that wall doesn't block any player's path to goal
    const tempWalls: QuoridorWall[] = [...walls, { x, y, orientation }];
    for (const player of playerArray) {
      if (!hasPathToGoal(tempWalls, boardSize, player.x, player.y, player.goalRow)) {
        return false;
      }
    }

    return true;
  }, [walls, boardSize, playerArray]);

  const isValidMove = useCallback((fromX: number, fromY: number, toX: number, toY: number): boolean => {
    // Bounds check
    if (toX < 0 || toX >= boardSize || toY < 0 || toY >= boardSize) return false;

    const dx = toX - fromX;
    const dy = toY - fromY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const oppPos = opponent ? { x: opponent.x, y: opponent.y } : null;

    // Simple adjacent move
    if ((absDx === 1 && absDy === 0) || (absDx === 0 && absDy === 1)) {
      if (oppPos && oppPos.x === toX && oppPos.y === toY) return false;
      if (isWallBlocking(walls, fromX, fromY, toX, toY)) return false;
      return true;
    }

    // Straight jump over opponent
    if ((absDx === 2 && absDy === 0) || (absDx === 0 && absDy === 2)) {
      if (!oppPos) return false;
      const midX = fromX + dx / 2;
      const midY = fromY + dy / 2;
      if (oppPos.x !== midX || oppPos.y !== midY) return false;
      if (isWallBlocking(walls, fromX, fromY, midX, midY)) return false;
      if (isWallBlocking(walls, midX, midY, toX, toY)) return false;
      return true;
    }

    // Diagonal jump (when straight jump blocked)
    if (absDx === 1 && absDy === 1 && oppPos) {
      const oppDx = oppPos.x - fromX;
      const oppDy = oppPos.y - fromY;
      const adjOpp = (Math.abs(oppDx) === 1 && oppDy === 0) || (oppDx === 0 && Math.abs(oppDy) === 1);
      if (!adjOpp) return false;

      const behindX = oppPos.x + oppDx;
      const behindY = oppPos.y + oppDy;
      const straightBlocked = behindX < 0 || behindX >= boardSize || behindY < 0 || behindY >= boardSize ||
        isWallBlocking(walls, oppPos.x, oppPos.y, behindX, behindY);
      if (!straightBlocked) return false;

      if (isWallBlocking(walls, fromX, fromY, oppPos.x, oppPos.y)) return false;
      if (isWallBlocking(walls, oppPos.x, oppPos.y, toX, toY)) return false;
      return true;
    }

    return false;
  }, [boardSize, opponent, walls]);

  const canMoveToCell = useCallback((col: number, row: number): boolean => {
    if (!myPlayer || disabled || !isMyTurn || isFinished) return false;
    return isValidMove(myPlayer.x, myPlayer.y, col, row);
  }, [myPlayer, disabled, isMyTurn, isFinished, isValidMove]);

  const handleCellClick = useCallback((col: number, row: number) => {
    if (canMoveToCell(col, row)) {
      setLastMoveFrom({ x: myPlayer!.x, y: myPlayer!.y });
      onMove(col, row);
    }
  }, [canMoveToCell, onMove, myPlayer]);

  const handleCellHover = useCallback((col: number, row: number) => {
    setHoveredCell({ x: col, y: row });
    setHoveredWall(null); // Clear wall hover when hovering over cell
  }, []);

  const handleWallHover = useCallback((x: number, y: number, orientation: "horizontal" | "vertical") => {
    setHoveredWall({ x, y, orientation });
    setHoveredCell(null); // Clear cell hover when hovering over wall
  }, []);

  const handleWallClick = useCallback((x: number, y: number, orientation: "horizontal" | "vertical") => {
    console.log("handleWallClick:", { x, y, orientation, isMyTurn, disabled, isFinished, wallsRemaining: myPlayer?.wallsRemaining, isValid: isWallPlacementValid(x, y, orientation) });

    if (!isMyTurn || disabled || isFinished) {
      console.log("Wall click blocked: game state");
      return;
    }
    if (myPlayer && myPlayer.wallsRemaining <= 0) {
      console.log("Wall click blocked: no walls remaining");
      return;
    }
    if (!isWallPlacementValid(x, y, orientation)) {
      console.log("Wall click blocked: invalid placement");
      return;
    }
    console.log("Wall click: placing wall");
    onPlaceWall(x, y, orientation);
  }, [isMyTurn, disabled, isFinished, myPlayer, isWallPlacementValid, onPlaceWall]);

  const gridSize = boardSize * CELL_SIZE + (boardSize - 1) * GAP_SIZE;

  return (
    <div className="flex flex-col items-center">
      {/* Turn indicator with timer */}
      <div className="mb-4 text-center">
        <div className="flex items-center justify-center gap-4">
          {disabled ? (
            <span className="text-surface-400">Game not started</span>
          ) : isMyTurn ? (
            <span className="text-success font-medium">Your turn!</span>
          ) : (
            <span className="text-surface-400">Waiting for opponent...</span>
          )}
          {!disabled && turnStartedAt > 0 && (
            <span
              className={`font-mono text-lg font-bold px-3 py-1 rounded-lg transition-colors ${
                isTimeLow
                  ? "bg-red-500/20 text-red-400 animate-pulse"
                  : "bg-surface-700 text-surface-300"
              }`}
            >
              {formatTime(timeRemaining)}
            </span>
          )}
        </div>
      </div>



      {/* Board */}
      <div 
        className="bg-surface-800 p-4 rounded-2xl shadow-lg relative"
        style={{ width: gridSize + 32, height: gridSize + 32 }}
      >
        {/* Goal rows indicators */}
        <div 
          className="absolute top-2 left-4 right-4 h-1 bg-gradient-to-r from-error/50 to-error/50 rounded"
          title="Opponent's goal"
        />
        <div 
          className="absolute bottom-2 left-4 right-4 h-1 bg-gradient-to-r from-primary-500/50 to-primary-500/50 rounded"
          title="Your goal"
        />

        <div className="relative" style={{ width: gridSize, height: gridSize }}>
          {/* Horizontal wall gaps (between rows) */}
          {Array.from({ length: boardSize - 1 }).map((_, row) =>
            Array.from({ length: boardSize }).map((_, col) => {
              const wallX = col;
              const wallY = row;
              const canPlaceWall = isMyTurn && !disabled && !isFinished && myPlayer && myPlayer.wallsRemaining > 0 && isWallPlacementValid(wallX, wallY, "horizontal");
              const isHovered = hoveredWall?.x === wallX && hoveredWall?.y === wallY && hoveredWall?.orientation === "horizontal";

              return (
                <div
                  key={`h-wall-${row}-${col}`}
                  onMouseEnter={() => handleWallHover(wallX, wallY, "horizontal")}
                  onClick={() => handleWallClick(wallX, wallY, "horizontal")}
                  className={`absolute z-10 ${canPlaceWall ? "cursor-pointer" : "cursor-not-allowed"}`}
                  style={{
                    left: col * (CELL_SIZE + GAP_SIZE),
                    top: row * (CELL_SIZE + GAP_SIZE) + CELL_SIZE,
                    width: CELL_SIZE,
                    height: GAP_SIZE,
                  }}
                >
                  {/* Wall preview on hover */}
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0, scaleY: 0.5 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      className={canPlaceWall ? "bg-amber-500" : "bg-red-500/50"}
                      style={{
                        width: CELL_SIZE * 2 + GAP_SIZE,
                        height: GAP_SIZE,
                        borderRadius: 2,
                        position: "absolute",
                        left: 0,
                        top: 0,
                      }}
                    />
                  )}
                </div>
              );
            })
          )}

          {/* Vertical wall gaps (between columns) */}
          {Array.from({ length: boardSize }).map((_, row) =>
            Array.from({ length: boardSize - 1 }).map((_, col) => {
              const wallX = col;
              const wallY = row;
              const canPlaceWall = isMyTurn && !disabled && !isFinished && myPlayer && myPlayer.wallsRemaining > 0 && isWallPlacementValid(wallX, wallY, "vertical");
              const isHovered = hoveredWall?.x === wallX && hoveredWall?.y === wallY && hoveredWall?.orientation === "vertical";

              return (
                <div
                  key={`v-wall-${row}-${col}`}
                  onMouseEnter={() => handleWallHover(wallX, wallY, "vertical")}
                  onClick={() => handleWallClick(wallX, wallY, "vertical")}
                  className={`absolute z-10 ${canPlaceWall ? "cursor-pointer" : "cursor-not-allowed"}`}
                  style={{
                    left: col * (CELL_SIZE + GAP_SIZE) + CELL_SIZE,
                    top: row * (CELL_SIZE + GAP_SIZE),
                    width: GAP_SIZE,
                    height: CELL_SIZE,
                  }}
                >
                  {/* Wall preview on hover */}
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0, scaleX: 0.5 }}
                      animate={{ opacity: 1, scaleX: 1 }}
                      className={canPlaceWall ? "bg-amber-500" : "bg-red-500/50"}
                      style={{
                        width: GAP_SIZE,
                        height: CELL_SIZE * 2 + GAP_SIZE,
                        borderRadius: 2,
                        position: "absolute",
                        left: 0,
                        top: 0,
                      }}
                    />
                  )}
                </div>
              );
            })
          )}

          {/* Cells */}
          {Array.from({ length: boardSize }).map((_, row) =>
            Array.from({ length: boardSize }).map((_, col) => {
              const myPlayerHere = myPlayer && myPlayer.x === col && myPlayer.y === row;
              const opponentHere = opponent && opponent.x === col && opponent.y === row;
              const canMove = canMoveToCell(col, row);
              const isHovered = hoveredCell?.x === col && hoveredCell?.y === row;
              const isLastMoveFrom = lastMoveFrom?.x === col && lastMoveFrom?.y === row;

              return (
                <div
                  key={`${row}-${col}`}
                  onMouseEnter={() => handleCellHover(col, row)}
                  onClick={() => handleCellClick(col, row)}
                  className={`
                    absolute rounded-lg transition-all duration-200
                    ${canMove ? "cursor-pointer" : ""}
                    ${isLastMoveFrom ? "ring-4 ring-accent-400/50" : ""}
                  `}
                  style={{
                    left: col * (CELL_SIZE + GAP_SIZE),
                    top: row * (CELL_SIZE + GAP_SIZE),
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                  }}
                >
                  {/* Cell background */}
                  <div className={`
                    w-full h-full rounded-lg border-2 transition-all duration-200
                    ${canMove ? "bg-primary-500/30 border-primary-400" : "bg-surface-700 border-surface-600"}
                    ${myPlayerHere || opponentHere ? "border-white/50" : ""}
                  `} />

                  {/* Move indicator */}
                  {canMove && isHovered && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="w-3 h-3 rounded-full bg-primary-400 ring-2 ring-white/50" />
                    </motion.div>
                  )}

                  {/* Pawns */}
                  {myPlayerHere && (
                    <motion.div
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="w-9 h-9 rounded-full bg-primary-500 shadow-lg border-2 border-white/30" />
                    </motion.div>
                  )}
                  {opponentHere && (
                    <motion.div
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="w-9 h-9 rounded-full bg-error shadow-lg border-2 border-white/30" />
                    </motion.div>
                  )}
                </div>
              );
            })
          )}

          {/* Placed walls */}
          {walls.map((wall, i) => {
            const left = wall.x * (CELL_SIZE + GAP_SIZE) + CELL_SIZE + GAP_SIZE / 2;
            const top = wall.y * (CELL_SIZE + GAP_SIZE) + CELL_SIZE + GAP_SIZE / 2;

            return (
              <div
                key={`placed-wall-${i}`}
                className="absolute bg-amber-600 z-20 rounded"
                style={
                  wall.orientation === "horizontal"
                    ? {
                        left: left - (CELL_SIZE * 2 + GAP_SIZE) / 2,
                        top: top - GAP_SIZE / 2,
                        width: CELL_SIZE * 2 + GAP_SIZE,
                        height: GAP_SIZE,
                      }
                    : {
                        left: left - GAP_SIZE / 2,
                        top: top - (CELL_SIZE * 2 + GAP_SIZE) / 2,
                        width: GAP_SIZE,
                        height: CELL_SIZE * 2 + GAP_SIZE,
                      }
                }
              />
            );
          })}
        </div>
      </div>

      {/* Win popup */}
      {isFinished && winnerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-surface-950/70 backdrop-blur-sm" />
          <div className="relative card max-w-md w-full p-6 text-center">
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 ${
              winnerId === playerId ? "bg-success/20" : "bg-error/20"
            }`}>
              {winnerId === playerId ? (
                <span className="text-4xl">🏆</span>
              ) : (
                <span className="text-4xl">😔</span>
              )}
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {winnerId === playerId ? "You Won!" : "You Lost"}
            </h2>
            <p className="text-surface-400 mb-6">
              {winnerId === playerId ? "Congratulations!" : "Better luck next time!"}
            </p>
          </div>
        </div>
      )}

      {/* Player info */}
      <div className="mt-6 flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary-500 border-2 border-white/30" />
          <span className="text-sm">
            You ({myPlayer?.wallsRemaining || 0} walls)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-error border-2 border-white/30" />
          <span className="text-sm">
            {opponent?.displayName || "Opponent"} ({opponent?.wallsRemaining || 0} walls)
          </span>
        </div>
      </div>

      {/* Wall count */}
      {myPlayer && (
        <div className="mb-4 text-center">
          <div className="text-surface-400 text-sm">
            Walls remaining: {myPlayer.wallsRemaining}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mb-4 text-center text-surface-500 text-sm">
        <p>Click highlighted squares to move your pawn, or hover between squares to place walls</p>
      </div>
    </div>
  );
}
