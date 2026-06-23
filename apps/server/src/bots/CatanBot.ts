import { BotAgent, BotConfig } from "./BotAgent.js";

type ResourceType = "wood" | "brick" | "wheat" | "sheep" | "ore";

interface CatanTile {
  q: number;
  r: number;
  tileType: string;
  number: number;
  hasRobber: boolean;
}

interface CatanVertex {
  id: string;
  building: string;
  playerId: string;
}

interface CatanEdge {
  id: string;
  hasRoad: boolean;
  playerId: string;
}

interface CatanPlayer {
  id: string;
  wood: number;
  brick: number;
  wheat: number;
  sheep: number;
  ore: number;
  points: number;
  roadsBuilt: number;
  settlementsBuilt: number;
  citiesBuilt: number;
  hasLongestRoad: boolean;
}

interface CatanGameState {
  phase: string;
  setupRound: number;
  lastDiceRoll: number;
  tiles: CatanTile[];
  vertices: Map<string, CatanVertex>;
  edges: Map<string, CatanEdge>;
  players: Map<string, CatanPlayer>;
  currentTurnId: string;
  pointsToWin: number;
}

type BotMove =
  | { action: "roll" }
  | { action: "settlement"; vertexId: string }
  | { action: "road"; edgeId: string }
  | { action: "city"; vertexId: string }
  | { action: "bank_trade"; give: ResourceType; giveAmount: number; receive: ResourceType }
  | { action: "end_trade" }
  | { action: "end_turn" }
  | { action: "move_robber"; q: number; r: number; stealFromPlayerId?: string };

/**
 * Catan bot - heuristic player
 *
 * Strategy:
 * - Setup: place settlements at high-probability, diverse-resource vertices
 * - Build order: road → settlement → city (prefer points per resource)
 * - Robber: move to tile producing opponent's resources, steal from leader
 * - Trade: only when stuck with 4+ of a resource and need something specific
 */
export class CatanBot extends BotAgent {
  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, {
      ...config,
      thinkingDelay: config.thinkingDelay || 1000,
    });
  }

  calculateMove(gameState: CatanGameState): BotMove {
    const phase = gameState.phase;

    switch (phase) {
      case "setup":
        return this.handleSetup(gameState);
      case "roll":
        return { action: "roll" };
      case "robber":
        return this.handleRobber(gameState);
      case "trade":
        return this.handleTrade(gameState);
      case "build":
        return this.handleBuild(gameState);
      default:
        return { action: "end_turn" };
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  private handleSetup(gameState: CatanGameState): BotMove {
    const player = gameState.players.get(this.playerId);
    if (!player) return { action: "end_turn" };

    // Check if we need to place settlement or road
    const mySettlements = Array.from(gameState.vertices.values()).filter(
      (v) => v.building && v.playerId === this.playerId
    );

    // Each setup round: settlement first, then road
    const expectedSettlements = gameState.setupRound === 1 ? 1 : 2;

    if (mySettlements.length < expectedSettlements) {
      return this.chooseBestSettlementVertex(gameState, true);
    }

    // Place road adjacent to the most recent settlement
    const lastSettlement = mySettlements[mySettlements.length - 1];
    return this.chooseBestAdjacentEdge(gameState, lastSettlement.id);
  }

  private chooseBestSettlementVertex(gameState: CatanGameState, setup: boolean): BotMove {
    let bestId = "";
    let bestScore = -1;

    for (const [id, vertex] of gameState.vertices) {
      if (vertex.building) continue;
      if (this.hasAdjacentBuilding(id, gameState)) continue;
      if (!setup && !this.hasConnectedRoad(id, gameState)) continue;

      const score = this.scoreVertex(id, gameState);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }

    return bestId ? { action: "settlement", vertexId: bestId } : { action: "end_turn" };
  }

  private chooseBestAdjacentEdge(gameState: CatanGameState, settlementId: string): BotMove {
    let bestId = "";

    for (const [id, edge] of gameState.edges) {
      if (edge.hasRoad) continue;
      if (this.edgeConnectsToVertex(id, settlementId)) {
        bestId = id;
        break;
      }
    }

    return bestId ? { action: "road", edgeId: bestId } : { action: "end_turn" };
  }

  /** Score a vertex by the sum of probability dots of adjacent tiles */
  private scoreVertex(vertexId: string, gameState: CatanGameState): number {
    const parts = vertexId.split(",");
    const q = parseInt(parts[0]);
    const r = parseInt(parts[1]);

    const PIPS: Record<number, number> = {
      2: 1,
      3: 2,
      4: 3,
      5: 4,
      6: 5,
      8: 5,
      9: 4,
      10: 3,
      11: 2,
      12: 1,
    };

    let score = 0;
    const resourcesSeen = new Set<string>();

    for (const tile of gameState.tiles) {
      if (Math.abs(tile.q - q) <= 1 && Math.abs(tile.r - r) <= 1) {
        if (tile.tileType !== "desert") {
          score += PIPS[tile.number] || 0;
          // Bonus for resource diversity
          if (!resourcesSeen.has(tile.tileType)) {
            score += 2;
            resourcesSeen.add(tile.tileType);
          }
        }
      }
    }

    return score;
  }

  // ── Robber ─────────────────────────────────────────────────────────────────

  private handleRobber(gameState: CatanGameState): BotMove {
    const me = gameState.players.get(this.playerId);

    // Find the opponent leading in points
    let leaderId = "";
    let leaderPoints = -1;
    for (const [id, p] of gameState.players) {
      if (id !== this.playerId && p.points > leaderPoints) {
        leaderPoints = p.points;
        leaderId = id;
      }
    }

    // Move robber to a tile occupied by the leader (or any opponent)
    for (const tile of gameState.tiles) {
      if (tile.hasRobber) continue;
      const vertices = this.getHexVertices(tile.q, tile.r);
      for (const vId of vertices) {
        const vertex = gameState.vertices.get(vId);
        if (vertex?.building && vertex.playerId === leaderId) {
          return {
            action: "move_robber",
            q: tile.q,
            r: tile.r,
            stealFromPlayerId: leaderId,
          };
        }
      }
    }

    // Fallback: move robber to any non-current tile
    for (const tile of gameState.tiles) {
      if (!tile.hasRobber && tile.tileType !== "desert") {
        return { action: "move_robber", q: tile.q, r: tile.r };
      }
    }

    // Last resort: stay on desert or first tile
    const first = gameState.tiles[0];
    return { action: "move_robber", q: first.q, r: first.r };
  }

  // ── Trade ──────────────────────────────────────────────────────────────────

  private handleTrade(gameState: CatanGameState): BotMove {
    const player = gameState.players.get(this.playerId);
    if (!player) return { action: "end_trade" };

    const resources: Record<ResourceType, number> = {
      wood: player.wood,
      brick: player.brick,
      wheat: player.wheat,
      sheep: player.sheep,
      ore: player.ore,
    };

    // Try to trade 4:1 if we have surplus and need something
    for (const give of Object.keys(resources) as ResourceType[]) {
      if (resources[give] < 4) continue;

      // Determine what we need most
      const needed = this.mostNeededResource(resources, give);
      if (needed) {
        return {
          action: "bank_trade",
          give,
          giveAmount: 4,
          receive: needed,
        };
      }
    }

    return { action: "end_trade" };
  }

  private mostNeededResource(
    resources: Record<ResourceType, number>,
    skip: ResourceType
  ): ResourceType | null {
    // Priority: try to build settlement, then road, then city
    const ROAD: ResourceType[] = ["wood", "brick"];
    const SETTLEMENT: ResourceType[] = ["wood", "brick", "wheat", "sheep"];
    const CITY: ResourceType[] = ["wheat", "wheat", "ore", "ore", "ore"];

    // Find what's missing for settlement
    for (const r of SETTLEMENT) {
      if (r !== skip && resources[r] < 1) return r;
    }
    // Find what's missing for road
    for (const r of ROAD) {
      if (r !== skip && resources[r] < 1) return r;
    }
    // Find what's missing for city
    for (const r of CITY) {
      if (r !== skip && resources[r] < 1) return r;
    }

    return null;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  private handleBuild(gameState: CatanGameState): BotMove {
    const player = gameState.players.get(this.playerId);
    if (!player) return { action: "end_turn" };

    // Priority 1: upgrade settlement to city (high VP per resource)
    if (player.wheat >= 2 && player.ore >= 3) {
      const mySettlement = Array.from(gameState.vertices.values()).find(
        (v) => v.building === "settlement" && v.playerId === this.playerId
      );
      if (mySettlement) {
        return { action: "city", vertexId: mySettlement.id };
      }
    }

    // Priority 2: build settlement (VP + resource access)
    if (player.wood >= 1 && player.brick >= 1 && player.wheat >= 1 && player.sheep >= 1) {
      const move = this.chooseBestSettlementVertex(gameState, false);
      if (move.action === "settlement") return move;
    }

    // Priority 3: build road (prerequisite for settlement)
    if (player.wood >= 1 && player.brick >= 1) {
      const edgeId = this.chooseBestRoadEdge(gameState);
      if (edgeId) return { action: "road", edgeId };
    }

    return { action: "end_turn" };
  }

  private chooseBestRoadEdge(gameState: CatanGameState): string | null {
    // Find an edge that extends toward a good settlement spot
    for (const [id, edge] of gameState.edges) {
      if (edge.hasRoad) continue;
      if (this.edgeConnectedToPlayerNetwork(id, gameState)) {
        return id;
      }
    }
    return null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getHexVertices(q: number, r: number): string[] {
    return [
      `${q},${r},N`,
      `${q},${r},NE`,
      `${q},${r},SE`,
      `${q},${r},S`,
      `${q},${r},SW`,
      `${q},${r},NW`,
    ];
  }

  private hasAdjacentBuilding(vertexId: string, gameState: CatanGameState): boolean {
    const [q1, r1] = vertexId.split(",").map(Number);
    for (const [id, vertex] of gameState.vertices) {
      if (id !== vertexId && vertex.building) {
        const [q2, r2] = id.split(",").map(Number);
        if (Math.abs(q1 - q2) <= 1 && Math.abs(r1 - r2) <= 1) return true;
      }
    }
    return false;
  }

  private hasConnectedRoad(vertexId: string, gameState: CatanGameState): boolean {
    for (const [eid, edge] of gameState.edges) {
      if (edge.hasRoad && edge.playerId === this.playerId) {
        if (this.edgeConnectsToVertex(eid, vertexId)) return true;
      }
    }
    return false;
  }

  private edgeConnectsToVertex(edgeId: string, vertexId: string): boolean {
    const ep = edgeId.split(",");
    const vp = vertexId.split(",");
    return ep[0] === vp[0] && ep[1] === vp[1];
  }

  private edgeConnectedToPlayerNetwork(edgeId: string, gameState: CatanGameState): boolean {
    // Check if edge connects to our road or settlement
    for (const [eid, edge] of gameState.edges) {
      if (edge.hasRoad && edge.playerId === this.playerId) {
        const ep1 = edgeId.split(",");
        const ep2 = eid.split(",");
        if (ep1[0] === ep2[0] && ep1[1] === ep2[1]) return true;
      }
    }
    for (const [vid, vertex] of gameState.vertices) {
      if (vertex.building && vertex.playerId === this.playerId) {
        if (this.edgeConnectsToVertex(edgeId, vid)) return true;
      }
    }
    return false;
  }
}
