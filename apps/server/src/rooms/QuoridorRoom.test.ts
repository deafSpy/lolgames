import { describe, it, expect } from "vitest";

// BFS pathfinding for Quoridor
interface Position {
  x: number;
  y: number;
}

interface Wall {
  x: number;
  y: number;
  orientation: "horizontal" | "vertical";
}

const BOARD_SIZE = 9;

function isWallBlocking(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  walls: Wall[]
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

function hasPathToGoal(startX: number, startY: number, goalRow: number, walls: Wall[]): boolean {
  const visited = new Set<string>();
  const queue: Position[] = [{ x: startX, y: startY }];
  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.y === goalRow) {
      return true;
    }

    const neighbors: Position[] = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 ||
        neighbor.x >= BOARD_SIZE ||
        neighbor.y < 0 ||
        neighbor.y >= BOARD_SIZE
      ) {
        continue;
      }

      const key = `${neighbor.x},${neighbor.y}`;
      if (visited.has(key)) continue;

      if (isWallBlocking(current.x, current.y, neighbor.x, neighbor.y, walls)) {
        continue;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return false;
}

function wallsCollide(
  x1: number,
  y1: number,
  o1: "horizontal" | "vertical",
  x2: number,
  y2: number,
  o2: "horizontal" | "vertical"
): boolean {
  // Same center position = collision
  if (x1 === x2 && y1 === y2) return true;

  // Same orientation - check if overlapping
  if (o1 === o2) {
    if (o1 === "horizontal" && y1 === y2 && Math.abs(x1 - x2) === 1) return true;
    if (o1 === "vertical" && x1 === x2 && Math.abs(y1 - y2) === 1) return true;
  }

  return false;
}

describe("Quoridor Pathfinding", () => {
  describe("hasPathToGoal", () => {
    it("should find path on empty board", () => {
      expect(hasPathToGoal(4, 8, 0, [])).toBe(true);
      expect(hasPathToGoal(4, 0, 8, [])).toBe(true);
    });

    it("should find path around single wall", () => {
      const walls: Wall[] = [{ x: 3, y: 4, orientation: "horizontal" }];
      expect(hasPathToGoal(4, 8, 0, walls)).toBe(true);
    });

    it("should find path around multiple walls", () => {
      const walls: Wall[] = [
        { x: 0, y: 4, orientation: "horizontal" },
        { x: 2, y: 4, orientation: "horizontal" },
        { x: 4, y: 4, orientation: "horizontal" },
      ];
      expect(hasPathToGoal(4, 8, 0, walls)).toBe(true);
    });

    it("should detect blocked path", () => {
      // Create a wall across the entire board at row 4
      const walls: Wall[] = [
        { x: 0, y: 4, orientation: "horizontal" },
        { x: 2, y: 4, orientation: "horizontal" },
        { x: 4, y: 4, orientation: "horizontal" },
        { x: 6, y: 4, orientation: "horizontal" },
      ];
      expect(hasPathToGoal(4, 8, 0, walls)).toBe(false);
    });

    it("should find path from corner", () => {
      expect(hasPathToGoal(0, 0, 8, [])).toBe(true);
      expect(hasPathToGoal(8, 8, 0, [])).toBe(true);
    });
  });

  describe("isWallBlocking", () => {
    it("should detect horizontal wall blocking vertical movement", () => {
      const walls: Wall[] = [{ x: 3, y: 4, orientation: "horizontal" }];
      
      // Moving from (4, 4) to (4, 5) should be blocked
      expect(isWallBlocking(4, 4, 4, 5, walls)).toBe(true);
      // Moving from (3, 4) to (3, 5) should be blocked
      expect(isWallBlocking(3, 4, 3, 5, walls)).toBe(true);
      // Moving from (5, 4) to (5, 5) should NOT be blocked
      expect(isWallBlocking(5, 4, 5, 5, walls)).toBe(false);
    });

    it("should detect vertical wall blocking horizontal movement", () => {
      const walls: Wall[] = [{ x: 4, y: 3, orientation: "vertical" }];
      
      // Moving from (4, 4) to (5, 4) should be blocked
      expect(isWallBlocking(4, 4, 5, 4, walls)).toBe(true);
      // Moving from (4, 3) to (5, 3) should be blocked
      expect(isWallBlocking(4, 3, 5, 3, walls)).toBe(true);
      // Moving from (4, 5) to (5, 5) should NOT be blocked
      expect(isWallBlocking(4, 5, 5, 5, walls)).toBe(false);
    });

    it("should not block movement parallel to wall", () => {
      const walls: Wall[] = [{ x: 4, y: 4, orientation: "horizontal" }];
      
      // Horizontal movement should not be blocked by horizontal wall
      expect(isWallBlocking(4, 4, 5, 4, walls)).toBe(false);
      expect(isWallBlocking(4, 5, 5, 5, walls)).toBe(false);
    });
  });

  describe("wallsCollide", () => {
    it("should detect walls at same position", () => {
      expect(wallsCollide(4, 4, "horizontal", 4, 4, "horizontal")).toBe(true);
      expect(wallsCollide(4, 4, "vertical", 4, 4, "vertical")).toBe(true);
      expect(wallsCollide(4, 4, "horizontal", 4, 4, "vertical")).toBe(true);
    });

    it("should detect overlapping horizontal walls", () => {
      expect(wallsCollide(4, 4, "horizontal", 5, 4, "horizontal")).toBe(true);
      expect(wallsCollide(4, 4, "horizontal", 3, 4, "horizontal")).toBe(true);
    });

    it("should detect overlapping vertical walls", () => {
      expect(wallsCollide(4, 4, "vertical", 4, 5, "vertical")).toBe(true);
      expect(wallsCollide(4, 4, "vertical", 4, 3, "vertical")).toBe(true);
    });

    it("should not detect non-overlapping walls", () => {
      expect(wallsCollide(4, 4, "horizontal", 6, 4, "horizontal")).toBe(false);
      expect(wallsCollide(4, 4, "vertical", 4, 6, "vertical")).toBe(false);
      expect(wallsCollide(4, 4, "horizontal", 4, 5, "horizontal")).toBe(false);
    });
  });
});

describe("Quoridor Pawn Movement", () => {
  function isValidPawnMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    opponentPos: Position | null,
    walls: Wall[]
  ): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Simple adjacent move
    if ((absDx === 1 && absDy === 0) || (absDx === 0 && absDy === 1)) {
      if (isWallBlocking(fromX, fromY, toX, toY, walls)) return false;
      if (opponentPos && opponentPos.x === toX && opponentPos.y === toY) return false;
      return true;
    }

    // Jump over opponent (straight)
    if ((absDx === 2 && absDy === 0) || (absDx === 0 && absDy === 2)) {
      const midX = fromX + dx / 2;
      const midY = fromY + dy / 2;
      if (!opponentPos || opponentPos.x !== midX || opponentPos.y !== midY) return false;
      if (isWallBlocking(fromX, fromY, midX, midY, walls)) return false;
      if (isWallBlocking(midX, midY, toX, toY, walls)) return false;
      return true;
    }

    return false;
  }

  it("should allow adjacent moves", () => {
    expect(isValidPawnMove(4, 4, 4, 3, null, [])).toBe(true);
    expect(isValidPawnMove(4, 4, 4, 5, null, [])).toBe(true);
    expect(isValidPawnMove(4, 4, 3, 4, null, [])).toBe(true);
    expect(isValidPawnMove(4, 4, 5, 4, null, [])).toBe(true);
  });

  it("should not allow diagonal moves", () => {
    expect(isValidPawnMove(4, 4, 5, 5, null, [])).toBe(false);
    expect(isValidPawnMove(4, 4, 3, 3, null, [])).toBe(false);
  });

  it("should not allow moving to opponent position", () => {
    expect(isValidPawnMove(4, 4, 4, 3, { x: 4, y: 3 }, [])).toBe(false);
  });

  it("should allow jumping over opponent", () => {
    expect(isValidPawnMove(4, 4, 4, 2, { x: 4, y: 3 }, [])).toBe(true);
    expect(isValidPawnMove(4, 4, 4, 6, { x: 4, y: 5 }, [])).toBe(true);
    expect(isValidPawnMove(4, 4, 2, 4, { x: 3, y: 4 }, [])).toBe(true);
    expect(isValidPawnMove(4, 4, 6, 4, { x: 5, y: 4 }, [])).toBe(true);
  });

  it("should not allow jump without opponent in middle", () => {
    expect(isValidPawnMove(4, 4, 4, 2, null, [])).toBe(false);
    expect(isValidPawnMove(4, 4, 4, 2, { x: 4, y: 5 }, [])).toBe(false);
  });

  it("should block moves through walls", () => {
    const walls: Wall[] = [{ x: 3, y: 3, orientation: "horizontal" }];
    expect(isValidPawnMove(4, 3, 4, 4, null, walls)).toBe(false);
  });
});
