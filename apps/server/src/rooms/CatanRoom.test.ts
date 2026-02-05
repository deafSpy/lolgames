import { describe, it, expect } from "vitest";

// Catan game logic tests
type ResourceType = "wood" | "brick" | "wheat" | "sheep" | "ore";

interface CatanTile {
  q: number;
  r: number;
  tileType: string;
  number: number;
  hasRobber: boolean;
}

interface Resources {
  wood: number;
  brick: number;
  wheat: number;
  sheep: number;
  ore: number;
}

// Building costs
const ROAD_COST: Partial<Resources> = { wood: 1, brick: 1 };
const SETTLEMENT_COST: Partial<Resources> = { wood: 1, brick: 1, wheat: 1, sheep: 1 };
const CITY_COST: Partial<Resources> = { wheat: 2, ore: 3 };

function canAfford(resources: Resources, cost: Partial<Resources>): boolean {
  for (const [resource, amount] of Object.entries(cost)) {
    if ((resources[resource as ResourceType] || 0) < (amount || 0)) {
      return false;
    }
  }
  return true;
}

function subtractResources(resources: Resources, cost: Partial<Resources>): Resources {
  const result = { ...resources };
  for (const [resource, amount] of Object.entries(cost)) {
    result[resource as ResourceType] = (result[resource as ResourceType] || 0) - (amount || 0);
  }
  return result;
}

function calculateDiceProb(number: number): number {
  // Returns the probability dots (pips) for a number
  // 7 is the most common (6 ways), then 6/8 (5 ways), etc.
  const ways: Record<number, number> = {
    2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
    8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
  };
  return ways[number] || 0;
}

function cubeDistance(q1: number, r1: number, q2: number, r2: number): number {
  // Convert axial to cube coordinates
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

function getHexNeighbors(q: number, r: number): Array<{ q: number; r: number }> {
  return [
    { q: q + 1, r: r },
    { q: q - 1, r: r },
    { q: q, r: r + 1 },
    { q: q, r: r - 1 },
    { q: q + 1, r: r - 1 },
    { q: q - 1, r: r + 1 },
  ];
}

function adjacentNumbersValid(tiles: CatanTile[]): boolean {
  // 6s and 8s should not be adjacent
  const highProbTiles = tiles.filter(t => t.number === 6 || t.number === 8);
  
  for (const tile of highProbTiles) {
    const neighbors = getHexNeighbors(tile.q, tile.r);
    for (const neighbor of neighbors) {
      const neighborTile = tiles.find(t => t.q === neighbor.q && t.r === neighbor.r);
      if (neighborTile && (neighborTile.number === 6 || neighborTile.number === 8)) {
        return false;
      }
    }
  }
  
  return true;
}

describe("Catan Resource Management", () => {
  describe("canAfford", () => {
    it("should allow purchase when resources are sufficient", () => {
      const resources: Resources = { wood: 2, brick: 2, wheat: 1, sheep: 1, ore: 0 };
      expect(canAfford(resources, ROAD_COST)).toBe(true);
      expect(canAfford(resources, SETTLEMENT_COST)).toBe(true);
    });

    it("should deny purchase when resources are insufficient", () => {
      const resources: Resources = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };
      expect(canAfford(resources, ROAD_COST)).toBe(false);
      expect(canAfford(resources, SETTLEMENT_COST)).toBe(false);
    });

    it("should check city cost correctly", () => {
      const resources: Resources = { wood: 0, brick: 0, wheat: 2, sheep: 0, ore: 3 };
      expect(canAfford(resources, CITY_COST)).toBe(true);
      
      const lowOre: Resources = { wood: 0, brick: 0, wheat: 2, sheep: 0, ore: 2 };
      expect(canAfford(lowOre, CITY_COST)).toBe(false);
    });
  });

  describe("subtractResources", () => {
    it("should correctly subtract resources", () => {
      const resources: Resources = { wood: 3, brick: 2, wheat: 1, sheep: 1, ore: 0 };
      const result = subtractResources(resources, SETTLEMENT_COST);
      
      expect(result.wood).toBe(2);
      expect(result.brick).toBe(1);
      expect(result.wheat).toBe(0);
      expect(result.sheep).toBe(0);
    });
  });
});

describe("Catan Dice Probability", () => {
  it("should return correct pips for each number", () => {
    expect(calculateDiceProb(7)).toBe(0); // 7 has no production
    expect(calculateDiceProb(6)).toBe(5);
    expect(calculateDiceProb(8)).toBe(5);
    expect(calculateDiceProb(2)).toBe(1);
    expect(calculateDiceProb(12)).toBe(1);
    expect(calculateDiceProb(5)).toBe(4);
    expect(calculateDiceProb(9)).toBe(4);
  });
});

describe("Catan Hex Coordinates", () => {
  describe("cubeDistance", () => {
    it("should calculate distance between adjacent hexes", () => {
      expect(cubeDistance(0, 0, 1, 0)).toBe(1);
      expect(cubeDistance(0, 0, 0, 1)).toBe(1);
      expect(cubeDistance(0, 0, 1, -1)).toBe(1);
    });

    it("should calculate distance between non-adjacent hexes", () => {
      expect(cubeDistance(0, 0, 2, 0)).toBe(2);
      expect(cubeDistance(0, 0, 0, 2)).toBe(2);
      expect(cubeDistance(0, 0, 2, -2)).toBe(2);
    });

    it("should return 0 for same hex", () => {
      expect(cubeDistance(0, 0, 0, 0)).toBe(0);
      expect(cubeDistance(3, -1, 3, -1)).toBe(0);
    });
  });

  describe("getHexNeighbors", () => {
    it("should return 6 neighbors", () => {
      const neighbors = getHexNeighbors(0, 0);
      expect(neighbors.length).toBe(6);
    });

    it("should return correct neighbor coordinates", () => {
      const neighbors = getHexNeighbors(0, 0);
      expect(neighbors).toContainEqual({ q: 1, r: 0 });
      expect(neighbors).toContainEqual({ q: -1, r: 0 });
      expect(neighbors).toContainEqual({ q: 0, r: 1 });
      expect(neighbors).toContainEqual({ q: 0, r: -1 });
      expect(neighbors).toContainEqual({ q: 1, r: -1 });
      expect(neighbors).toContainEqual({ q: -1, r: 1 });
    });
  });
});

describe("Catan Board Validation", () => {
  describe("adjacentNumbersValid", () => {
    it("should pass when 6s and 8s are not adjacent", () => {
      const tiles: CatanTile[] = [
        { q: 0, r: 0, tileType: "wheat", number: 6, hasRobber: false },
        { q: 2, r: 0, tileType: "ore", number: 8, hasRobber: false },
        { q: 1, r: 0, tileType: "wood", number: 5, hasRobber: false },
      ];
      expect(adjacentNumbersValid(tiles)).toBe(true);
    });

    it("should fail when 6s are adjacent", () => {
      const tiles: CatanTile[] = [
        { q: 0, r: 0, tileType: "wheat", number: 6, hasRobber: false },
        { q: 1, r: 0, tileType: "ore", number: 6, hasRobber: false },
      ];
      expect(adjacentNumbersValid(tiles)).toBe(false);
    });

    it("should fail when 6 and 8 are adjacent", () => {
      const tiles: CatanTile[] = [
        { q: 0, r: 0, tileType: "wheat", number: 6, hasRobber: false },
        { q: 1, r: -1, tileType: "ore", number: 8, hasRobber: false },
      ];
      expect(adjacentNumbersValid(tiles)).toBe(false);
    });
  });
});

describe("Catan Trading", () => {
  function canBankTrade(resources: Resources, give: ResourceType, receive: ResourceType, ratio = 4): boolean {
    return resources[give] >= ratio && give !== receive;
  }

  it("should allow 4:1 bank trade with sufficient resources", () => {
    const resources: Resources = { wood: 5, brick: 0, wheat: 0, sheep: 0, ore: 0 };
    expect(canBankTrade(resources, "wood", "brick")).toBe(true);
  });

  it("should deny bank trade with insufficient resources", () => {
    const resources: Resources = { wood: 3, brick: 0, wheat: 0, sheep: 0, ore: 0 };
    expect(canBankTrade(resources, "wood", "brick")).toBe(false);
  });

  it("should deny trading same resource type", () => {
    const resources: Resources = { wood: 5, brick: 0, wheat: 0, sheep: 0, ore: 0 };
    expect(canBankTrade(resources, "wood", "wood")).toBe(false);
  });
});

describe("Catan Victory Points", () => {
  function calculateVictoryPoints(settlements: number, cities: number, longestRoad: boolean): number {
    let points = 0;
    points += settlements; // 1 point each
    points += cities * 2; // 2 points each
    if (longestRoad) points += 2;
    return points;
  }

  it("should calculate points for settlements", () => {
    expect(calculateVictoryPoints(2, 0, false)).toBe(2);
    expect(calculateVictoryPoints(5, 0, false)).toBe(5);
  });

  it("should calculate points for cities", () => {
    expect(calculateVictoryPoints(0, 2, false)).toBe(4);
    expect(calculateVictoryPoints(2, 2, false)).toBe(6);
  });

  it("should add longest road bonus", () => {
    expect(calculateVictoryPoints(2, 2, true)).toBe(8);
  });

  it("should reach winning score of 10", () => {
    // 3 settlements (3) + 2 cities (4) + longest road (2) = 9, need one more
    expect(calculateVictoryPoints(4, 2, true)).toBe(10);
  });
});
