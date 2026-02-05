import { Client } from "@colyseus/core";
import {
  CatanState,
  CatanPlayerSchema,
  CatanTileSchema,
  CatanVertexSchema,
  CatanEdgeSchema,
} from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

type ResourceType = "wood" | "brick" | "wheat" | "sheep" | "ore";
type TileType = ResourceType | "desert";
type CatanPhase = "setup" | "roll" | "trade" | "build" | "robber";

interface BuildData {
  action: "settlement" | "city" | "road";
  vertexId?: string;
  edgeId?: string;
}

interface TradeData {
  action: "bank_trade";
  give: ResourceType;
  giveAmount: number;
  receive: ResourceType;
}

interface RobberData {
  action: "move_robber";
  q: number;
  r: number;
  stealFromPlayerId?: string;
}

const TILE_TYPES: TileType[] = [
  "wood", "wood", "wood", "wood",
  "brick", "brick", "brick",
  "wheat", "wheat", "wheat", "wheat",
  "sheep", "sheep", "sheep", "sheep",
  "ore", "ore", "ore",
  "desert",
];

const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// Standard Catan hex positions (axial coordinates)
const HEX_POSITIONS = [
  { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 },
  { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 2, r: -1 },
  { q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
  { q: -2, r: 1 }, { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 },
  { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 2 },
];

export class CatanRoom extends BaseRoom<CatanState> {
  maxClients = 4;
  private playerOrder: string[] = [];

  initializeGame(): void {
    this.setState(new CatanState());
    this.state.status = "waiting";
    this.state.phase = "setup";
    this.state.setupRound = 1;
    this.generateBoard();
  }

  private generateBoard(): void {
    // Shuffle tiles
    const shuffledTiles = [...TILE_TYPES].sort(() => Math.random() - 0.5);
    const shuffledNumbers = [...NUMBERS].sort(() => Math.random() - 0.5);

    let numberIndex = 0;

    // Create tiles
    for (let i = 0; i < HEX_POSITIONS.length; i++) {
      const tile = new CatanTileSchema();
      tile.q = HEX_POSITIONS[i].q;
      tile.r = HEX_POSITIONS[i].r;
      tile.tileType = shuffledTiles[i];

      if (tile.tileType === "desert") {
        tile.number = 0;
        tile.hasRobber = true;
      } else {
        tile.number = shuffledNumbers[numberIndex++];
      }

      this.state.tiles.push(tile);
    }

    // Generate vertices and edges
    this.generateVerticesAndEdges();
  }

  private generateVerticesAndEdges(): void {
    const vertexSet = new Set<string>();
    const edgeSet = new Set<string>();

    for (const tile of this.state.tiles) {
      // Each hex has 6 vertices (N, NE, SE, S, SW, NW) and 6 edges
      const vertices = this.getHexVertices(tile.q, tile.r);
      const edges = this.getHexEdges(tile.q, tile.r);

      for (const v of vertices) {
        if (!vertexSet.has(v)) {
          vertexSet.add(v);
          const vertex = new CatanVertexSchema();
          vertex.id = v;
          vertex.building = "";
          vertex.playerId = "";
          this.state.vertices.set(v, vertex);
        }
      }

      for (const e of edges) {
        if (!edgeSet.has(e)) {
          edgeSet.add(e);
          const edge = new CatanEdgeSchema();
          edge.id = e;
          edge.hasRoad = false;
          edge.playerId = "";
          this.state.edges.set(e, edge);
        }
      }
    }
  }

  private getHexVertices(q: number, r: number): string[] {
    // Use a canonical representation for shared vertices
    return [
      `${q},${r},N`,
      `${q},${r},NE`,
      `${q},${r},SE`,
      `${q},${r},S`,
      `${q},${r},SW`,
      `${q},${r},NW`,
    ];
  }

  private getHexEdges(q: number, r: number): string[] {
    return [
      `${q},${r},N`,
      `${q},${r},NE`,
      `${q},${r},E`,
      `${q},${r},SE`,
      `${q},${r},S`,
      `${q},${r},SW`,
    ];
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new CatanPlayerSchema();
    player.id = client.sessionId;
    player.displayName = options.playerName || `Guest_${client.sessionId.slice(0, 4)}`;
    player.isReady = false;
    player.isConnected = true;
    player.joinedAt = Date.now();
    
    // Starting resources: none
    player.wood = 0;
    player.brick = 0;
    player.wheat = 0;
    player.sheep = 0;
    player.ore = 0;
    player.points = 0;

    this.state.players.set(client.sessionId, player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, playerName: player.displayName },
      "Player joined Catan"
    );

    if (this.clients.length >= this.maxClients) {
      this.lock();
    }
  }

  protected startGame(): void {
    this.state.status = "in_progress";
    this.state.phase = "setup";
    this.state.setupRound = 1;

    // Set player order
    this.playerOrder = Array.from(this.state.players.keys());
    this.state.currentTurnId = this.playerOrder[0];
    this.state.turnStartedAt = Date.now();

    logger.info({ roomId: this.roomId }, "Catan game started - setup phase");
    this.broadcast("game_started", { firstPlayer: this.state.currentTurnId, phase: "setup" });
    this.startTurnTimer();
  }

  handleMove(client: Client, data: unknown): void {
    const phase = this.state.phase as CatanPhase;
    const moveData = data as { action: string };

    switch (phase) {
      case "setup":
        this.handleSetupMove(client, data as BuildData);
        break;
      case "roll":
        if (moveData.action === "roll") {
          this.handleRoll(client);
        }
        break;
      case "trade":
        if (moveData.action === "bank_trade") {
          this.handleBankTrade(client, data as TradeData);
        } else if (moveData.action === "end_trade") {
          this.state.phase = "build";
          this.broadcast("phase_changed", { phase: "build" });
        }
        break;
      case "build":
        if (moveData.action === "end_turn") {
          this.handleEndTurn(client);
        } else {
          this.handleBuild(client, data as BuildData);
        }
        break;
      case "robber":
        this.handleRobber(client, data as RobberData);
        break;
    }
  }

  private handleSetupMove(client: Client, data: BuildData): void {
    const player = this.state.players.get(client.sessionId) as CatanPlayerSchema;

    if (data.action === "settlement" && data.vertexId) {
      if (!this.canBuildSettlementSetup(data.vertexId, client.sessionId)) {
        client.send("error", { message: "Cannot build settlement here" });
        return;
      }

      const vertex = this.state.vertices.get(data.vertexId);
      if (vertex) {
        vertex.building = "settlement";
        vertex.playerId = client.sessionId;
        player.settlementsBuilt++;
        player.points++;

        // In setup, get resources from adjacent tiles for second settlement
        if (this.state.setupRound === 2) {
          this.giveResourcesForVertex(data.vertexId, player);
        }

        this.broadcast("settlement_built", { playerId: client.sessionId, vertexId: data.vertexId });
      }
    } else if (data.action === "road" && data.edgeId) {
      if (!this.canBuildRoadSetup(data.edgeId, client.sessionId)) {
        client.send("error", { message: "Cannot build road here" });
        return;
      }

      const edge = this.state.edges.get(data.edgeId);
      if (edge) {
        edge.hasRoad = true;
        edge.playerId = client.sessionId;
        player.roadsBuilt++;
        this.broadcast("road_built", { playerId: client.sessionId, edgeId: data.edgeId });
      }

      // After road, move to next player
      this.advanceSetup();
    }
  }

  private advanceSetup(): void {
    const currentIndex = this.playerOrder.indexOf(this.state.currentTurnId);

    if (this.state.setupRound === 1) {
      // Forward order
      if (currentIndex < this.playerOrder.length - 1) {
        this.state.currentTurnId = this.playerOrder[currentIndex + 1];
      } else {
        // Last player goes again (reverse order starts)
        this.state.setupRound = 2;
      }
    } else {
      // Reverse order
      if (currentIndex > 0) {
        this.state.currentTurnId = this.playerOrder[currentIndex - 1];
      } else {
        // Setup complete, start normal play
        this.state.phase = "roll";
        this.state.currentTurnId = this.playerOrder[0];
        this.broadcast("phase_changed", { phase: "roll" });
        logger.info({ roomId: this.roomId }, "Setup complete, starting main game");
      }
    }

    this.state.turnStartedAt = Date.now();
    this.startTurnTimer();
  }

  private handleRoll(client: Client): void {
    const die1 = Math.floor(Math.random() * 6) + 1;
    const die2 = Math.floor(Math.random() * 6) + 1;
    const total = die1 + die2;
    this.state.lastDiceRoll = total;

    this.broadcast("dice_rolled", { die1, die2, total, playerId: client.sessionId });

    if (total === 7) {
      // Robber phase
      this.state.phase = "robber";
      this.broadcast("phase_changed", { phase: "robber" });
    } else {
      // Distribute resources
      this.distributeResources(total);
      this.state.phase = "trade";
      this.broadcast("phase_changed", { phase: "trade" });
    }
  }

  private distributeResources(roll: number): void {
    for (const tile of this.state.tiles) {
      if (tile.number === roll && !tile.hasRobber && tile.tileType !== "desert") {
        // Find vertices adjacent to this tile
        const vertices = this.getHexVertices(tile.q, tile.r);
        for (const vId of vertices) {
          const vertex = this.state.vertices.get(vId);
          if (vertex && vertex.building && vertex.playerId) {
            const player = this.state.players.get(vertex.playerId) as CatanPlayerSchema;
            if (player) {
              const amount = vertex.building === "city" ? 2 : 1;
              this.giveResource(player, tile.tileType as ResourceType, amount);
            }
          }
        }
      }
    }
  }

  private giveResource(player: CatanPlayerSchema, resource: ResourceType, amount: number): void {
    switch (resource) {
      case "wood": player.wood += amount; break;
      case "brick": player.brick += amount; break;
      case "wheat": player.wheat += amount; break;
      case "sheep": player.sheep += amount; break;
      case "ore": player.ore += amount; break;
    }
  }

  private takeResource(player: CatanPlayerSchema, resource: ResourceType, amount: number): boolean {
    switch (resource) {
      case "wood":
        if (player.wood < amount) return false;
        player.wood -= amount;
        break;
      case "brick":
        if (player.brick < amount) return false;
        player.brick -= amount;
        break;
      case "wheat":
        if (player.wheat < amount) return false;
        player.wheat -= amount;
        break;
      case "sheep":
        if (player.sheep < amount) return false;
        player.sheep -= amount;
        break;
      case "ore":
        if (player.ore < amount) return false;
        player.ore -= amount;
        break;
    }
    return true;
  }

  private handleBankTrade(client: Client, data: TradeData): void {
    const player = this.state.players.get(client.sessionId) as CatanPlayerSchema;
    
    // Standard 4:1 trade
    if (data.giveAmount !== 4) {
      client.send("error", { message: "Bank trades require 4:1 ratio" });
      return;
    }

    if (!this.takeResource(player, data.give, 4)) {
      client.send("error", { message: "Not enough resources" });
      return;
    }

    this.giveResource(player, data.receive, 1);
    this.broadcast("bank_trade", {
      playerId: client.sessionId,
      gave: { [data.give]: 4 },
      received: { [data.receive]: 1 },
    });
  }

  private handleBuild(client: Client, data: BuildData): void {
    const player = this.state.players.get(client.sessionId) as CatanPlayerSchema;

    switch (data.action) {
      case "road":
        if (!this.canBuildRoad(data.edgeId!, client.sessionId)) {
          client.send("error", { message: "Cannot build road here" });
          return;
        }
        if (!this.takeResource(player, "wood", 1) || !this.takeResource(player, "brick", 1)) {
          player.wood++; // Refund if partial
          client.send("error", { message: "Not enough resources (need 1 wood + 1 brick)" });
          return;
        }
        const edge = this.state.edges.get(data.edgeId!);
        if (edge) {
          edge.hasRoad = true;
          edge.playerId = client.sessionId;
          player.roadsBuilt++;
          this.updateLongestRoad();
          this.broadcast("road_built", { playerId: client.sessionId, edgeId: data.edgeId });
        }
        break;

      case "settlement":
        if (!this.canBuildSettlement(data.vertexId!, client.sessionId)) {
          client.send("error", { message: "Cannot build settlement here" });
          return;
        }
        if (!this.takeResource(player, "wood", 1) ||
            !this.takeResource(player, "brick", 1) ||
            !this.takeResource(player, "wheat", 1) ||
            !this.takeResource(player, "sheep", 1)) {
          // Refund any taken
          player.wood++; player.brick++; player.wheat++; player.sheep++;
          this.takeResource(player, "wood", 1); this.takeResource(player, "brick", 1);
          this.takeResource(player, "wheat", 1); this.takeResource(player, "sheep", 1);
          client.send("error", { message: "Not enough resources" });
          return;
        }
        const vertex = this.state.vertices.get(data.vertexId!);
        if (vertex) {
          vertex.building = "settlement";
          vertex.playerId = client.sessionId;
          player.settlementsBuilt++;
          player.points++;
          this.broadcast("settlement_built", { playerId: client.sessionId, vertexId: data.vertexId });
        }
        break;

      case "city":
        const cityVertex = this.state.vertices.get(data.vertexId!);
        if (!cityVertex || cityVertex.building !== "settlement" || cityVertex.playerId !== client.sessionId) {
          client.send("error", { message: "Must upgrade your own settlement" });
          return;
        }
        if (!this.takeResource(player, "wheat", 2) || !this.takeResource(player, "ore", 3)) {
          player.wheat += 2; player.ore += 3;
          this.takeResource(player, "wheat", 2); this.takeResource(player, "ore", 3);
          client.send("error", { message: "Not enough resources (need 2 wheat + 3 ore)" });
          return;
        }
        cityVertex.building = "city";
        player.settlementsBuilt--;
        player.citiesBuilt++;
        player.points++;
        this.broadcast("city_built", { playerId: client.sessionId, vertexId: data.vertexId });
        break;
    }

    // Check win after building
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
    }
  }

  private handleRobber(client: Client, data: RobberData): void {
    // Move robber
    for (const tile of this.state.tiles) {
      if (tile.q === data.q && tile.r === data.r) {
        // Can't move to same tile
        if (tile.hasRobber) {
          client.send("error", { message: "Robber already here" });
          return;
        }
      }
      tile.hasRobber = (tile.q === data.q && tile.r === data.r);
    }

    // Steal from player if specified
    if (data.stealFromPlayerId) {
      const victim = this.state.players.get(data.stealFromPlayerId) as CatanPlayerSchema;
      const thief = this.state.players.get(client.sessionId) as CatanPlayerSchema;
      
      if (victim && thief) {
        const resources: ResourceType[] = [];
        if (victim.wood > 0) resources.push(...Array(victim.wood).fill("wood"));
        if (victim.brick > 0) resources.push(...Array(victim.brick).fill("brick"));
        if (victim.wheat > 0) resources.push(...Array(victim.wheat).fill("wheat"));
        if (victim.sheep > 0) resources.push(...Array(victim.sheep).fill("sheep"));
        if (victim.ore > 0) resources.push(...Array(victim.ore).fill("ore"));

        if (resources.length > 0) {
          const stolen = resources[Math.floor(Math.random() * resources.length)];
          this.takeResource(victim, stolen, 1);
          this.giveResource(thief, stolen, 1);
          this.broadcast("resource_stolen", {
            thief: client.sessionId,
            victim: data.stealFromPlayerId,
          });
        }
      }
    }

    this.broadcast("robber_moved", { q: data.q, r: data.r });
    this.state.phase = "trade";
    this.broadcast("phase_changed", { phase: "trade" });
  }

  private handleEndTurn(client: Client): void {
    this.clearTurnTimer();
    this.nextTurn();
    this.state.phase = "roll";
    this.broadcast("phase_changed", { phase: "roll" });
  }

  private canBuildSettlementSetup(vertexId: string, playerId: string): boolean {
    const vertex = this.state.vertices.get(vertexId);
    if (!vertex || vertex.building) return false;

    // Check distance rule (no adjacent settlements)
    return !this.hasAdjacentBuilding(vertexId);
  }

  private canBuildSettlement(vertexId: string, playerId: string): boolean {
    if (!this.canBuildSettlementSetup(vertexId, playerId)) return false;

    // Must be connected to player's road
    return this.hasConnectedRoad(vertexId, playerId);
  }

  private canBuildRoadSetup(edgeId: string, playerId: string): boolean {
    const edge = this.state.edges.get(edgeId);
    if (!edge || edge.hasRoad) return false;

    // Must connect to player's settlement just built
    return this.hasConnectedSettlement(edgeId, playerId);
  }

  private canBuildRoad(edgeId: string, playerId: string): boolean {
    const edge = this.state.edges.get(edgeId);
    if (!edge || edge.hasRoad) return false;

    // Must connect to player's road, settlement, or city
    return this.hasConnectedRoad(edgeId, playerId) || this.hasConnectedSettlement(edgeId, playerId);
  }

  private hasAdjacentBuilding(vertexId: string): boolean {
    // Simplified: check vertices with similar IDs
    // In a real implementation, we'd have proper adjacency
    for (const [id, vertex] of this.state.vertices) {
      if (id !== vertexId && vertex.building && this.areVerticesAdjacent(vertexId, id)) {
        return true;
      }
    }
    return false;
  }

  private areVerticesAdjacent(v1: string, v2: string): boolean {
    // Simplified adjacency check based on hex positions
    const [q1, r1] = v1.split(",").map(Number);
    const [q2, r2] = v2.split(",").map(Number);
    return Math.abs(q1 - q2) <= 1 && Math.abs(r1 - r2) <= 1;
  }

  private hasConnectedRoad(location: string, playerId: string): boolean {
    for (const [, edge] of this.state.edges) {
      if (edge.hasRoad && edge.playerId === playerId) {
        if (this.edgeConnectsTo(edge.id, location)) return true;
      }
    }
    return false;
  }

  private hasConnectedSettlement(edgeId: string, playerId: string): boolean {
    for (const [vId, vertex] of this.state.vertices) {
      if (vertex.building && vertex.playerId === playerId) {
        if (this.edgeConnectsTo(edgeId, vId)) return true;
      }
    }
    return false;
  }

  private edgeConnectsTo(edgeId: string, vertexOrEdgeId: string): boolean {
    // Simplified: same hex base
    const edgeParts = edgeId.split(",");
    const otherParts = vertexOrEdgeId.split(",");
    return edgeParts[0] === otherParts[0] && edgeParts[1] === otherParts[1];
  }

  private giveResourcesForVertex(vertexId: string, player: CatanPlayerSchema): void {
    // Give one resource for each adjacent hex
    const [q, r] = vertexId.split(",").map(Number);
    for (const tile of this.state.tiles) {
      if (Math.abs(tile.q - q) <= 1 && Math.abs(tile.r - r) <= 1) {
        if (tile.tileType !== "desert") {
          this.giveResource(player, tile.tileType as ResourceType, 1);
        }
      }
    }
  }

  private updateLongestRoad(): void {
    // Simplified longest road - just count roads for now
    for (const [playerId, player] of this.state.players) {
      const p = player as CatanPlayerSchema;
      p.longestRoad = p.roadsBuilt;
    }

    // Find player with longest (5+)
    let longestPlayer: CatanPlayerSchema | null = null;
    let longest = 4; // Need at least 5

    for (const [, player] of this.state.players) {
      const p = player as CatanPlayerSchema;
      if (p.longestRoad > longest) {
        longest = p.longestRoad;
        longestPlayer = p;
      }
    }

    // Update longest road holder
    for (const [, player] of this.state.players) {
      const p = player as CatanPlayerSchema;
      const hadIt = p.hasLongestRoad;
      p.hasLongestRoad = (longestPlayer === p);
      
      if (p.hasLongestRoad && !hadIt) {
        p.points += 2;
      } else if (!p.hasLongestRoad && hadIt) {
        p.points -= 2;
      }
    }
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    for (const [playerId, player] of this.state.players) {
      const p = player as CatanPlayerSchema;
      if (p.points >= this.state.pointsToWin) {
        return { winner: playerId, isDraw: false };
      }
    }
    return null;
  }
}
