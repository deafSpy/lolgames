import { Client } from "@colyseus/core";
import {
  SplendorState,
  SplendorPlayerSchema,
  SplendorCardSchema,
  SplendorNobleSchema,
  ArraySchema,
} from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

type GemType = "white" | "blue" | "green" | "red" | "black";
type GemOrGold = GemType | "gold";

interface TakeGemsData {
  action: "take_gems";
  gems: Partial<Record<GemOrGold, number>>;
}

interface BuyCardData {
  action: "buy_card";
  cardId: string;
  tier?: number;
}

interface ReserveCardData {
  action: "reserve_card";
  cardId: string;
  tier: number;
  fromDeck?: boolean;
}

interface DiscardGemsData {
  action: "discard_gems";
  gems: Partial<Record<GemOrGold, number>>;
}

interface SelectNobleData {
  action: "select_noble";
  nobleId: string;
}

// Card definitions - Tier 1 (from official Splendor rules)
const TIER1_CARDS: Array<{
  gemType: GemType;
  points: number;
  cost: Partial<Record<GemType, number>>;
}> = [
  // White cards
  { gemType: "white", points: 0, cost: { black: 1 } },
  { gemType: "white", points: 0, cost: { red: 1, black: 1 } },
  { gemType: "white", points: 0, cost: { green: 1, red: 1, black: 1 } },
  { gemType: "white", points: 0, cost: { blue: 1, green: 1, red: 1, black: 1 } },
  { gemType: "white", points: 1, cost: { green: 2, red: 2 } },
  { gemType: "white", points: 1, cost: { green: 3 } },
  { gemType: "white", points: 2, cost: { red: 6 } },
  { gemType: "white", points: 2, cost: { blue: 2, green: 1 } },
  // Black cards
  { gemType: "black", points: 0, cost: { white: 1 } },
  { gemType: "black", points: 0, cost: { white: 1, red: 1 } },
  { gemType: "black", points: 0, cost: { white: 1, green: 1, red: 1 } },
  { gemType: "black", points: 0, cost: { white: 1, blue: 1, green: 1 } },
  { gemType: "black", points: 1, cost: { red: 3 } },
  { gemType: "black", points: 1, cost: { green: 2, red: 1 } },
  { gemType: "black", points: 2, cost: { green: 2, red: 2 } },
  { gemType: "black", points: 2, cost: { white: 1 } },
  // Blue cards
  { gemType: "blue", points: 0, cost: { black: 1 } },
  { gemType: "blue", points: 0, cost: { red: 1, black: 1 } },
  { gemType: "blue", points: 0, cost: { green: 1, red: 1, black: 1 } },
  { gemType: "blue", points: 0, cost: { white: 1, green: 1, black: 1 } },
  { gemType: "blue", points: 1, cost: { black: 3 } },
  { gemType: "blue", points: 1, cost: { green: 1, red: 2 } },
  { gemType: "blue", points: 2, cost: { green: 2, red: 1 } },
  { gemType: "blue", points: 2, cost: { white: 3 } },
  // Red cards
  { gemType: "red", points: 0, cost: { black: 1 } },
  { gemType: "red", points: 0, cost: { black: 1, red: 1 } },
  { gemType: "red", points: 0, cost: { green: 1, red: 1, black: 1 } },
  { gemType: "red", points: 0, cost: { white: 1, blue: 1, black: 1 } },
  { gemType: "red", points: 1, cost: { black: 3 } },
  { gemType: "red", points: 1, cost: { blue: 1, green: 2 } },
  { gemType: "red", points: 2, cost: { blue: 1, black: 2 } },
  { gemType: "red", points: 2, cost: { blue: 3 } },
  // Green cards
  { gemType: "green", points: 0, cost: { black: 1 } },
  { gemType: "green", points: 0, cost: { red: 1, black: 1 } },
  { gemType: "green", points: 0, cost: { green: 1, red: 1, black: 1 } },
  { gemType: "green", points: 0, cost: { white: 1, blue: 1, black: 1 } },
  { gemType: "green", points: 1, cost: { red: 3 } },
  { gemType: "green", points: 1, cost: { blue: 2, red: 1 } },
  { gemType: "green", points: 2, cost: { blue: 1, black: 2 } },
  { gemType: "green", points: 2, cost: { white: 3 } },
];

// Tier 2 cards (from official Splendor rules)
const TIER2_CARDS: Array<{
  gemType: GemType;
  points: number;
  cost: Partial<Record<GemType, number>>;
}> = [
  // White cards
  { gemType: "white", points: 1, cost: { white: 0, blue: 2, green: 2, red: 0, black: 3 } },
  { gemType: "white", points: 1, cost: { white: 2, blue: 3, green: 0, red: 0, black: 0 } },
  { gemType: "white", points: 2, cost: { white: 0, blue: 1, green: 4, red: 2, black: 0 } },
  { gemType: "white", points: 2, cost: { white: 0, blue: 0, green: 5, red: 3, black: 0 } },
  { gemType: "white", points: 2, cost: { white: 5, blue: 0, green: 0, red: 0, black: 0 } },
  { gemType: "white", points: 3, cost: { white: 6, blue: 0, green: 0, red: 0, black: 0 } },
  // Black cards
  { gemType: "black", points: 1, cost: { white: 3, blue: 0, green: 2, red: 2, black: 0 } },
  { gemType: "black", points: 1, cost: { white: 3, blue: 0, green: 0, red: 0, black: 3 } },
  { gemType: "black", points: 2, cost: { white: 0, blue: 1, green: 4, red: 0, black: 2 } },
  { gemType: "black", points: 2, cost: { white: 0, blue: 0, green: 5, red: 0, black: 3 } },
  { gemType: "black", points: 2, cost: { white: 0, blue: 0, green: 0, red: 0, black: 5 } },
  { gemType: "black", points: 3, cost: { white: 0, blue: 0, green: 0, red: 0, black: 6 } },
  // Blue cards
  { gemType: "blue", points: 1, cost: { white: 0, blue: 2, green: 2, red: 3, black: 0 } },
  { gemType: "blue", points: 1, cost: { white: 0, blue: 2, green: 3, red: 0, black: 3 } },
  { gemType: "blue", points: 2, cost: { white: 2, blue: 0, green: 0, red: 1, black: 4 } },
  { gemType: "blue", points: 2, cost: { white: 5, blue: 3, green: 0, red: 0, black: 0 } },
  { gemType: "blue", points: 2, cost: { white: 0, blue: 5, green: 0, red: 0, black: 0 } },
  { gemType: "blue", points: 3, cost: { white: 0, blue: 6, green: 0, red: 0, black: 0 } },
  // Red cards
  { gemType: "red", points: 1, cost: { white: 2, blue: 0, green: 0, red: 2, black: 3 } },
  { gemType: "red", points: 1, cost: { white: 0, blue: 3, green: 0, red: 2, black: 3 } },
  { gemType: "red", points: 2, cost: { white: 1, blue: 4, green: 2, red: 0, black: 0 } },
  { gemType: "red", points: 2, cost: { white: 3, blue: 0, green: 0, red: 0, black: 5 } },
  { gemType: "red", points: 2, cost: { white: 0, blue: 0, green: 0, red: 5, black: 0 } },
  { gemType: "red", points: 3, cost: { white: 0, blue: 0, green: 0, red: 6, black: 0 } },
  // Green cards
  { gemType: "green", points: 1, cost: { white: 0, blue: 0, green: 2, red: 3, black: 2 } },
  { gemType: "green", points: 1, cost: { white: 2, blue: 3, green: 0, red: 0, black: 2 } },
  { gemType: "green", points: 2, cost: { white: 4, blue: 2, green: 0, red: 0, black: 1 } },
  { gemType: "green", points: 2, cost: { white: 0, blue: 5, green: 3, red: 0, black: 0 } },
  { gemType: "green", points: 2, cost: { white: 0, blue: 0, green: 5, red: 0, black: 0 } },
  { gemType: "green", points: 3, cost: { white: 0, blue: 0, green: 6, red: 0, black: 0 } },
];

// Tier 3 cards (from official Splendor rules)
const TIER3_CARDS: Array<{
  gemType: GemType;
  points: number;
  cost: Partial<Record<GemType, number>>;
}> = [
  // White cards
  { gemType: "white", points: 3, cost: { white: 0, blue: 3, green: 3, red: 5, black: 3 } },
  { gemType: "white", points: 4, cost: { white: 0, blue: 0, green: 0, red: 0, black: 7 } },
  { gemType: "white", points: 4, cost: { white: 3, blue: 0, green: 0, red: 3, black: 6 } },
  { gemType: "white", points: 5, cost: { white: 3, blue: 0, green: 0, red: 0, black: 7 } },
  // Black cards
  { gemType: "black", points: 3, cost: { white: 3, blue: 3, green: 5, red: 3, black: 0 } },
  { gemType: "black", points: 4, cost: { white: 0, blue: 0, green: 0, red: 7, black: 0 } },
  { gemType: "black", points: 4, cost: { white: 0, blue: 0, green: 3, red: 6, black: 3 } },
  { gemType: "black", points: 5, cost: { white: 0, blue: 0, green: 0, red: 7, black: 3 } },
  // Blue cards
  { gemType: "blue", points: 3, cost: { white: 3, blue: 0, green: 3, red: 3, black: 5 } },
  { gemType: "blue", points: 4, cost: { white: 7, blue: 0, green: 0, red: 0, black: 0 } },
  { gemType: "blue", points: 4, cost: { white: 6, blue: 3, green: 0, red: 0, black: 3 } },
  { gemType: "blue", points: 5, cost: { white: 7, blue: 3, green: 0, red: 0, black: 0 } },
  // Red cards
  { gemType: "red", points: 3, cost: { white: 3, blue: 5, green: 3, red: 0, black: 3 } },
  { gemType: "red", points: 4, cost: { white: 0, blue: 0, green: 7, red: 0, black: 0 } },
  { gemType: "red", points: 4, cost: { white: 0, blue: 3, green: 6, red: 3, black: 0 } },
  { gemType: "red", points: 5, cost: { white: 0, blue: 0, green: 7, red: 3, black: 0 } },
  // Green cards
  { gemType: "green", points: 3, cost: { white: 5, blue: 3, green: 0, red: 3, black: 3 } },
  { gemType: "green", points: 4, cost: { white: 0, blue: 7, green: 0, red: 0, black: 0 } },
  { gemType: "green", points: 4, cost: { white: 3, blue: 6, green: 3, red: 0, black: 0 } },
  { gemType: "green", points: 5, cost: { white: 0, blue: 7, green: 3, red: 0, black: 0 } },
];

const NOBLES: Array<{
  points: number;
  requirements: Partial<Record<GemType, number>>;
}> = [
  { points: 3, requirements: { white: 3, blue: 3, black: 3 } },
  { points: 3, requirements: { white: 3, blue: 3, green: 3 } },
  { points: 3, requirements: { blue: 3, green: 3, red: 3 } },
  { points: 3, requirements: { green: 3, red: 3, black: 3 } },
  { points: 3, requirements: { white: 3, red: 3, black: 3 } },
  { points: 3, requirements: { white: 4, red: 4 } },
  { points: 3, requirements: { blue: 4, green: 4 } },
  { points: 3, requirements: { green: 4, black: 4 } },
  { points: 3, requirements: { white: 4, black: 4 } },
  { points: 3, requirements: { blue: 4, red: 4 } },
];

export class SplendorRoom extends BaseRoom<SplendorState> {
  maxClients = 4;
  private tier1Deck: SplendorCardSchema[] = [];
  private tier2Deck: SplendorCardSchema[] = [];
  private tier3Deck: SplendorCardSchema[] = [];

  initializeGame(): void {
    this.setState(new SplendorState());
    this.state.status = "waiting";
    this.state.phase = "take_gems";

    // Adjust gems for player count (done in startGame)
    this.initializeDecks();
  }

  private initializeDecks(): void {
    // Create and shuffle tier 1 deck
    this.tier1Deck = TIER1_CARDS.map((card, i) => {
      const c = new SplendorCardSchema();
      c.id = `t1_${i}`;
      c.tier = 1;
      c.gemType = card.gemType;
      c.points = card.points;
      c.costWhite = card.cost.white || 0;
      c.costBlue = card.cost.blue || 0;
      c.costGreen = card.cost.green || 0;
      c.costRed = card.cost.red || 0;
      c.costBlack = card.cost.black || 0;
      return c;
    });
    this.shuffleArray(this.tier1Deck);

    // Create and shuffle tier 2 deck
    this.tier2Deck = TIER2_CARDS.map((card, i) => {
      const c = new SplendorCardSchema();
      c.id = `t2_${i}`;
      c.tier = 2;
      c.gemType = card.gemType;
      c.points = card.points;
      c.costWhite = card.cost.white || 0;
      c.costBlue = card.cost.blue || 0;
      c.costGreen = card.cost.green || 0;
      c.costRed = card.cost.red || 0;
      c.costBlack = card.cost.black || 0;
      return c;
    });
    this.shuffleArray(this.tier2Deck);

    // Create and shuffle tier 3 deck
    this.tier3Deck = TIER3_CARDS.map((card, i) => {
      const c = new SplendorCardSchema();
      c.id = `t3_${i}`;
      c.tier = 3;
      c.gemType = card.gemType;
      c.points = card.points;
      c.costWhite = card.cost.white || 0;
      c.costBlue = card.cost.blue || 0;
      c.costGreen = card.cost.green || 0;
      c.costRed = card.cost.red || 0;
      c.costBlack = card.cost.black || 0;
      return c;
    });
    this.shuffleArray(this.tier3Deck);
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new SplendorPlayerSchema();
    player.id = client.sessionId;
    player.displayName = options.playerName || `Guest_${client.sessionId.slice(0, 4)}`;
    player.isReady = false;
    player.isConnected = true;
    player.joinedAt = Date.now();

    player.gemWhite = 0;
    player.gemBlue = 0;
    player.gemGreen = 0;
    player.gemRed = 0;
    player.gemBlack = 0;
    player.gemGold = 0;
    player.points = 0;

    this.state.players.set(client.sessionId, player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, playerName: player.displayName },
      "Player joined Splendor"
    );

    if (this.clients.length >= this.maxClients) {
      this.lock();
    }
  }

  protected startGame(): void {
    // Adjust gem count based on player count
    const playerCount = this.state.players.size;
    let gemCount = 7; // 4 players
    if (playerCount === 2) gemCount = 4;
    else if (playerCount === 3) gemCount = 5;

    this.state.bankWhite = gemCount;
    this.state.bankBlue = gemCount;
    this.state.bankGreen = gemCount;
    this.state.bankRed = gemCount;
    this.state.bankBlack = gemCount;
    this.state.bankGold = 5;

    // Deal 4 cards to each tier
    for (let i = 0; i < 4 && this.tier1Deck.length > 0; i++) {
      this.state.tier1Cards.push(this.tier1Deck.pop()!);
    }
    for (let i = 0; i < 4 && this.tier2Deck.length > 0; i++) {
      this.state.tier2Cards.push(this.tier2Deck.pop()!);
    }
    for (let i = 0; i < 4 && this.tier3Deck.length > 0; i++) {
      this.state.tier3Cards.push(this.tier3Deck.pop()!);
    }

    this.state.tier1Remaining = this.tier1Deck.length;
    this.state.tier2Remaining = this.tier2Deck.length;
    this.state.tier3Remaining = this.tier3Deck.length;

    // Set up nobles (players + 1)
    const shuffledNobles = [...NOBLES].sort(() => Math.random() - 0.5);
    for (let i = 0; i <= playerCount && i < shuffledNobles.length; i++) {
      const noble = new SplendorNobleSchema();
      noble.id = `noble_${i}`;
      noble.points = shuffledNobles[i].points;
      noble.reqWhite = shuffledNobles[i].requirements.white || 0;
      noble.reqBlue = shuffledNobles[i].requirements.blue || 0;
      noble.reqGreen = shuffledNobles[i].requirements.green || 0;
      noble.reqRed = shuffledNobles[i].requirements.red || 0;
      noble.reqBlack = shuffledNobles[i].requirements.black || 0;
      this.state.nobles.push(noble);
    }

    this.state.status = "in_progress";
    this.state.phase = "take_gems";

    const playerIds = Array.from(this.state.players.keys());
    this.state.currentTurnId = playerIds[0];
    this.state.turnStartedAt = Date.now();

    logger.info({ roomId: this.roomId }, "Splendor game started");
    this.broadcast("game_started", { firstPlayer: this.state.currentTurnId });
    this.startTurnTimer();
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as { action: string };
    const player = this.state.players.get(client.sessionId) as SplendorPlayerSchema;

    if (!player) {
      client.send("error", { message: "Player not found" });
      return;
    }

    switch (moveData.action) {
      case "take_gems":
        this.handleTakeGems(client, player, data as TakeGemsData);
        break;
      case "buy_card":
        this.handleBuyCard(client, player, data as BuyCardData);
        break;
      case "reserve_card":
        this.handleReserveCard(client, player, data as ReserveCardData);
        break;
      case "discard_gems":
        this.handleDiscardGems(client, player, data as DiscardGemsData);
        break;
      case "select_noble":
        this.handleSelectNoble(client, player, data as SelectNobleData);
        break;
      default:
        client.send("error", { message: "Invalid action" });
    }
  }

  private handleTakeGems(client: Client, player: SplendorPlayerSchema, data: TakeGemsData): void {
    const gems = data.gems;
    const gemTypes = Object.keys(gems) as GemOrGold[];

    // Can't take gold directly
    if (gems.gold && gems.gold > 0) {
      client.send("error", { message: "Cannot take gold tokens directly" });
      return;
    }

    // Calculate total gems being taken
    const totalTaking = Object.values(gems).reduce((sum, n) => sum + (n || 0), 0);

    // Validate the take action
    const distinctColors = gemTypes.filter((g) => (gems[g] || 0) > 0);

    // Option 1: Take 3 different colors (1 each)
    // Option 2: Take 2 of the same color (if 4+ available in bank)
    if (distinctColors.length === 3) {
      // Taking 3 different colors
      for (const gem of distinctColors) {
        if ((gems[gem] || 0) !== 1) {
          client.send("error", { message: "When taking 3 colors, must take 1 of each" });
          return;
        }
        if (!this.hasBankGems(gem as GemType, 1)) {
          client.send("error", { message: `Not enough ${gem} gems in bank` });
          return;
        }
      }
    } else if (distinctColors.length === 1 && (gems[distinctColors[0]] || 0) === 2) {
      // Taking 2 of the same
      const gem = distinctColors[0] as GemType;
      if (!this.hasBankGems(gem, 4)) {
        client.send("error", { message: `Need at least 4 ${gem} gems in bank to take 2` });
        return;
      }
    } else if (distinctColors.length <= 2 && totalTaking <= 2) {
      // Taking fewer gems (end of game, limited bank)
      for (const gem of distinctColors) {
        if (!this.hasBankGems(gem as GemType, gems[gem] || 0)) {
          client.send("error", { message: `Not enough ${gem} gems in bank` });
          return;
        }
      }
    } else {
      client.send("error", { message: "Invalid gem combination" });
      return;
    }

    // Execute the take
    for (const gem of distinctColors) {
      const amount = gems[gem] || 0;
      this.takeBankGems(gem as GemType, amount);
      this.givePlayerGems(player, gem as GemOrGold, amount);
    }

    this.broadcast("gems_taken", { playerId: client.sessionId, gems });

    // Check if player needs to discard
    if (this.getPlayerGemCount(player) > 10) {
      this.state.phase = "discard_gems";
      this.broadcast("phase_changed", { phase: "discard_gems" });
    } else {
      this.endTurn(client.sessionId);
    }
  }

  private handleBuyCard(client: Client, player: SplendorPlayerSchema, data: BuyCardData): void {
    // Find the card
    let card: SplendorCardSchema | undefined;
    let cardIndex = -1;
    let cardSource: "table" | "reserved" = "table";
    let tier: ArraySchema<SplendorCardSchema> | undefined;

    // Check table first
    for (const t of [this.state.tier1Cards, this.state.tier2Cards, this.state.tier3Cards]) {
      const idx = Array.from(t).findIndex((c) => c.id === data.cardId);
      if (idx !== -1) {
        card = t[idx];
        cardIndex = idx;
        tier = t;
        break;
      }
    }

    // Check reserved
    if (!card) {
      const idx = Array.from(player.reserved).findIndex((c) => c.id === data.cardId);
      if (idx !== -1) {
        card = player.reserved[idx];
        cardIndex = idx;
        cardSource = "reserved";
      }
    }

    if (!card) {
      client.send("error", { message: "Card not found" });
      return;
    }

    // Calculate cost after discounts
    const cardCounts = this.getPlayerCardCounts(player);
    const effectiveCost = {
      white: Math.max(0, card.costWhite - (cardCounts.white || 0)),
      blue: Math.max(0, card.costBlue - (cardCounts.blue || 0)),
      green: Math.max(0, card.costGreen - (cardCounts.green || 0)),
      red: Math.max(0, card.costRed - (cardCounts.red || 0)),
      black: Math.max(0, card.costBlack - (cardCounts.black || 0)),
    };

    // Check if player can afford it
    let goldNeeded = 0;
    for (const [gem, cost] of Object.entries(effectiveCost)) {
      const playerGems = this.getPlayerGem(player, gem as GemType);
      if (playerGems < cost) {
        goldNeeded += cost - playerGems;
      }
    }

    if (goldNeeded > player.gemGold) {
      client.send("error", { message: "Cannot afford this card" });
      return;
    }

    // Pay the cost
    for (const [gem, cost] of Object.entries(effectiveCost)) {
      let remaining = cost;
      const playerGems = this.getPlayerGem(player, gem as GemType);
      const fromGems = Math.min(playerGems, remaining);
      if (fromGems > 0) {
        this.takePlayerGems(player, gem as GemType, fromGems);
        this.returnBankGems(gem as GemType, fromGems);
        remaining -= fromGems;
      }
      if (remaining > 0) {
        this.takePlayerGems(player, "gold", remaining);
        this.state.bankGold += remaining;
      }
    }

    // Give card to player
    player.cards.push(card);
    player.points += card.points;

    // Remove from source
    if (cardSource === "table" && tier) {
      tier.splice(cardIndex, 1);
      // Refill from deck
      this.refillTier(card.tier as 1 | 2 | 3);
    } else {
      player.reserved.splice(cardIndex, 1);
    }

    this.broadcast("card_bought", { playerId: client.sessionId, cardId: card.id });

    // Check for nobles
    this.checkNobles(client, player);
  }

  private handleReserveCard(
    client: Client,
    player: SplendorPlayerSchema,
    data: ReserveCardData
  ): void {
    if (player.reserved.length >= 3) {
      client.send("error", { message: "Cannot reserve more than 3 cards" });
      return;
    }

    let card: SplendorCardSchema | undefined;

    if (data.fromDeck) {
      // Reserve from deck
      switch (data.tier) {
        case 1:
          if (this.tier1Deck.length > 0) {
            card = this.tier1Deck.pop()!;
            this.state.tier1Remaining = this.tier1Deck.length;
          }
          break;
        case 2:
          if (this.tier2Deck.length > 0) {
            card = this.tier2Deck.pop()!;
            this.state.tier2Remaining = this.tier2Deck.length;
          }
          break;
        case 3:
          if (this.tier3Deck.length > 0) {
            card = this.tier3Deck.pop()!;
            this.state.tier3Remaining = this.tier3Deck.length;
          }
          break;
      }
    } else {
      // Reserve from table
      const tiers = [null, this.state.tier1Cards, this.state.tier2Cards, this.state.tier3Cards];
      const tier = tiers[data.tier];
      if (tier) {
        const idx = Array.from(tier).findIndex((c) => c.id === data.cardId);
        if (idx !== -1) {
          card = tier[idx];
          tier.splice(idx, 1);
          this.refillTier(data.tier as 1 | 2 | 3);
        }
      }
    }

    if (!card) {
      client.send("error", { message: "Card not found" });
      return;
    }

    player.reserved.push(card);

    // Give gold token if available
    if (this.state.bankGold > 0) {
      this.state.bankGold--;
      player.gemGold++;
    }

    this.broadcast("card_reserved", { playerId: client.sessionId, tier: data.tier });

    // Check if player needs to discard
    if (this.getPlayerGemCount(player) > 10) {
      this.state.phase = "discard_gems";
      this.broadcast("phase_changed", { phase: "discard_gems" });
    } else {
      this.endTurn(client.sessionId);
    }
  }

  private handleDiscardGems(
    client: Client,
    player: SplendorPlayerSchema,
    data: DiscardGemsData
  ): void {
    const currentCount = this.getPlayerGemCount(player);
    const discardCount = Object.values(data.gems).reduce((sum, n) => sum + (n || 0), 0);

    if (currentCount - discardCount > 10) {
      client.send("error", { message: "Must discard down to 10 gems" });
      return;
    }

    // Return gems to bank
    for (const [gem, amount] of Object.entries(data.gems)) {
      if ((amount || 0) > 0) {
        const playerHas = this.getPlayerGem(player, gem as GemOrGold);
        if (playerHas < (amount || 0)) {
          client.send("error", { message: `Don't have enough ${gem} gems to discard` });
          return;
        }
        this.takePlayerGems(player, gem as GemOrGold, amount || 0);
        if (gem === "gold") {
          this.state.bankGold += amount || 0;
        } else {
          this.returnBankGems(gem as GemType, amount || 0);
        }
      }
    }

    this.broadcast("gems_discarded", { playerId: client.sessionId, gems: data.gems });

    if (this.getPlayerGemCount(player) <= 10) {
      this.endTurn(client.sessionId);
    }
  }

  private handleSelectNoble(
    client: Client,
    player: SplendorPlayerSchema,
    data: SelectNobleData
  ): void {
    const nobleIdx = Array.from(this.state.nobles).findIndex((n) => n.id === data.nobleId);
    if (nobleIdx === -1) {
      client.send("error", { message: "Noble not found" });
      return;
    }

    const noble = this.state.nobles[nobleIdx];

    // Verify player qualifies
    const cardCounts = this.getPlayerCardCounts(player);
    if (
      (cardCounts.white || 0) < noble.reqWhite ||
      (cardCounts.blue || 0) < noble.reqBlue ||
      (cardCounts.green || 0) < noble.reqGreen ||
      (cardCounts.red || 0) < noble.reqRed ||
      (cardCounts.black || 0) < noble.reqBlack
    ) {
      client.send("error", { message: "Don't qualify for this noble" });
      return;
    }

    player.nobles.push(noble);
    player.points += noble.points;
    this.state.nobles.splice(nobleIdx, 1);

    this.broadcast("noble_acquired", { playerId: client.sessionId, nobleId: data.nobleId });

    this.state.phase = "take_gems";
    this.endTurn(client.sessionId);
  }

  private checkNobles(client: Client, player: SplendorPlayerSchema): void {
    const cardCounts = this.getPlayerCardCounts(player);
    const qualifyingNobles: SplendorNobleSchema[] = [];

    for (const noble of this.state.nobles) {
      if (
        (cardCounts.white || 0) >= noble.reqWhite &&
        (cardCounts.blue || 0) >= noble.reqBlue &&
        (cardCounts.green || 0) >= noble.reqGreen &&
        (cardCounts.red || 0) >= noble.reqRed &&
        (cardCounts.black || 0) >= noble.reqBlack
      ) {
        qualifyingNobles.push(noble);
      }
    }

    if (qualifyingNobles.length === 0) {
      this.endTurn(client.sessionId);
    } else if (qualifyingNobles.length === 1) {
      // Auto-acquire
      const noble = qualifyingNobles[0];
      const idx = Array.from(this.state.nobles).indexOf(noble);
      player.nobles.push(noble);
      player.points += noble.points;
      this.state.nobles.splice(idx, 1);
      this.broadcast("noble_acquired", { playerId: client.sessionId, nobleId: noble.id });
      this.endTurn(client.sessionId);
    } else {
      // Player must choose
      this.state.phase = "select_noble";
      this.broadcast("phase_changed", {
        phase: "select_noble",
        nobles: qualifyingNobles.map((n) => n.id),
      });
    }
  }

  private endTurn(playerId: string): void {
    this.state.phase = "take_gems";

    // Check win condition first
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }

    this.nextTurn();
    this.broadcast("turn_ended", { playerId });
  }

  protected refillTier(tier: 1 | 2 | 3): void {
    const deck = tier === 1 ? this.tier1Deck : tier === 2 ? this.tier2Deck : this.tier3Deck;
    const cards =
      tier === 1
        ? this.state.tier1Cards
        : tier === 2
          ? this.state.tier2Cards
          : this.state.tier3Cards;

    if (deck.length > 0 && cards.length < 4) {
      cards.push(deck.pop()!);
      if (tier === 1) this.state.tier1Remaining = this.tier1Deck.length;
      else if (tier === 2) this.state.tier2Remaining = this.tier2Deck.length;
      else this.state.tier3Remaining = this.tier3Deck.length;
    }
  }

  private hasBankGems(gem: GemType, amount: number): boolean {
    switch (gem) {
      case "white":
        return this.state.bankWhite >= amount;
      case "blue":
        return this.state.bankBlue >= amount;
      case "green":
        return this.state.bankGreen >= amount;
      case "red":
        return this.state.bankRed >= amount;
      case "black":
        return this.state.bankBlack >= amount;
    }
  }

  private takeBankGems(gem: GemType, amount: number): void {
    switch (gem) {
      case "white":
        this.state.bankWhite -= amount;
        break;
      case "blue":
        this.state.bankBlue -= amount;
        break;
      case "green":
        this.state.bankGreen -= amount;
        break;
      case "red":
        this.state.bankRed -= amount;
        break;
      case "black":
        this.state.bankBlack -= amount;
        break;
    }
  }

  private returnBankGems(gem: GemType, amount: number): void {
    switch (gem) {
      case "white":
        this.state.bankWhite += amount;
        break;
      case "blue":
        this.state.bankBlue += amount;
        break;
      case "green":
        this.state.bankGreen += amount;
        break;
      case "red":
        this.state.bankRed += amount;
        break;
      case "black":
        this.state.bankBlack += amount;
        break;
    }
  }

  private getPlayerGem(player: SplendorPlayerSchema, gem: GemOrGold): number {
    switch (gem) {
      case "white":
        return player.gemWhite;
      case "blue":
        return player.gemBlue;
      case "green":
        return player.gemGreen;
      case "red":
        return player.gemRed;
      case "black":
        return player.gemBlack;
      case "gold":
        return player.gemGold;
    }
  }

  private givePlayerGems(player: SplendorPlayerSchema, gem: GemOrGold, amount: number): void {
    switch (gem) {
      case "white":
        player.gemWhite += amount;
        break;
      case "blue":
        player.gemBlue += amount;
        break;
      case "green":
        player.gemGreen += amount;
        break;
      case "red":
        player.gemRed += amount;
        break;
      case "black":
        player.gemBlack += amount;
        break;
      case "gold":
        player.gemGold += amount;
        break;
    }
  }

  private takePlayerGems(player: SplendorPlayerSchema, gem: GemOrGold, amount: number): void {
    switch (gem) {
      case "white":
        player.gemWhite -= amount;
        break;
      case "blue":
        player.gemBlue -= amount;
        break;
      case "green":
        player.gemGreen -= amount;
        break;
      case "red":
        player.gemRed -= amount;
        break;
      case "black":
        player.gemBlack -= amount;
        break;
      case "gold":
        player.gemGold -= amount;
        break;
    }
  }

  private getPlayerGemCount(player: SplendorPlayerSchema): number {
    return (
      player.gemWhite +
      player.gemBlue +
      player.gemGreen +
      player.gemRed +
      player.gemBlack +
      player.gemGold
    );
  }

  private getPlayerCardCounts(player: SplendorPlayerSchema): Partial<Record<GemType, number>> {
    const counts: Partial<Record<GemType, number>> = {
      white: 0,
      blue: 0,
      green: 0,
      red: 0,
      black: 0,
    };
    for (const card of player.cards) {
      counts[card.gemType as GemType] = (counts[card.gemType as GemType] || 0) + 1;
    }
    return counts;
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    // Game ends when someone reaches 15 points
    // But we finish the round so everyone gets equal turns
    let leader: { id: string; points: number } | null = null;

    for (const [playerId, player] of this.state.players) {
      const p = player as SplendorPlayerSchema;
      if (p.points >= this.state.pointsToWin) {
        if (!leader || p.points > leader.points) {
          leader = { id: playerId, points: p.points };
        }
      }
    }

    if (leader) {
      // Check if we've completed the round (returned to first player)
      const playerIds = Array.from(this.state.players.keys());
      if (this.state.currentTurnId === playerIds[0]) {
        return { winner: leader.id, isDraw: false };
      }
    }

    return null;
  }
}
