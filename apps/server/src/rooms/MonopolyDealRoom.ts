import { Client } from "@colyseus/core";
import {
  MonopolyDealState,
  MonopolyDealPlayerSchema,
  MonopolyDealCardSchema,
  MonopolyDealPropertySetSchema,
  MonopolyDealActionRequestSchema,
  ArraySchema,
} from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

// Property set requirements (how many cards complete a set)
const SET_REQUIREMENTS: Record<string, number> = {
  brown: 2,
  light_blue: 3,
  pink: 3,
  orange: 3,
  red: 3,
  yellow: 3,
  green: 3,
  dark_blue: 2,
  railroad: 4,
  utility: 2,
};

// Rent values per set size for each color
const RENT_VALUES: Record<string, number[]> = {
  brown: [1, 2],
  light_blue: [1, 2, 3],
  pink: [1, 2, 4],
  orange: [1, 3, 5],
  red: [2, 3, 6],
  yellow: [2, 4, 6],
  green: [2, 4, 7],
  dark_blue: [3, 8],
  railroad: [1, 2, 3, 4],
  utility: [1, 2],
};

// Card definitions for the deck
interface CardDef {
  type: "money" | "property" | "wildcard" | "action" | "rent";
  value: number;
  name: string;
  count: number;
  actionType?: string;
  color?: string;
  colors?: string[];
  rentValues?: number[];
}

const CARD_DEFINITIONS: CardDef[] = [
  // Money cards
  { type: "money", value: 1, name: "$1M", count: 6 },
  { type: "money", value: 2, name: "$2M", count: 5 },
  { type: "money", value: 3, name: "$3M", count: 3 },
  { type: "money", value: 4, name: "$4M", count: 3 },
  { type: "money", value: 5, name: "$5M", count: 2 },
  { type: "money", value: 10, name: "$10M", count: 1 },

  // Properties
  { type: "property", value: 1, name: "Mediterranean Avenue", count: 1, color: "brown" },
  { type: "property", value: 1, name: "Baltic Avenue", count: 1, color: "brown" },
  { type: "property", value: 1, name: "Oriental Avenue", count: 1, color: "light_blue" },
  { type: "property", value: 1, name: "Vermont Avenue", count: 1, color: "light_blue" },
  { type: "property", value: 1, name: "Connecticut Avenue", count: 1, color: "light_blue" },
  { type: "property", value: 2, name: "St. Charles Place", count: 1, color: "pink" },
  { type: "property", value: 2, name: "States Avenue", count: 1, color: "pink" },
  { type: "property", value: 2, name: "Virginia Avenue", count: 1, color: "pink" },
  { type: "property", value: 2, name: "St. James Place", count: 1, color: "orange" },
  { type: "property", value: 2, name: "Tennessee Avenue", count: 1, color: "orange" },
  { type: "property", value: 2, name: "New York Avenue", count: 1, color: "orange" },
  { type: "property", value: 3, name: "Kentucky Avenue", count: 1, color: "red" },
  { type: "property", value: 3, name: "Indiana Avenue", count: 1, color: "red" },
  { type: "property", value: 3, name: "Illinois Avenue", count: 1, color: "red" },
  { type: "property", value: 3, name: "Atlantic Avenue", count: 1, color: "yellow" },
  { type: "property", value: 3, name: "Ventnor Avenue", count: 1, color: "yellow" },
  { type: "property", value: 3, name: "Marvin Gardens", count: 1, color: "yellow" },
  { type: "property", value: 4, name: "Pacific Avenue", count: 1, color: "green" },
  { type: "property", value: 4, name: "North Carolina Avenue", count: 1, color: "green" },
  { type: "property", value: 4, name: "Pennsylvania Avenue", count: 1, color: "green" },
  { type: "property", value: 4, name: "Park Place", count: 1, color: "dark_blue" },
  { type: "property", value: 4, name: "Boardwalk", count: 1, color: "dark_blue" },
  { type: "property", value: 2, name: "Reading Railroad", count: 1, color: "railroad" },
  { type: "property", value: 2, name: "Pennsylvania Railroad", count: 1, color: "railroad" },
  { type: "property", value: 2, name: "B&O Railroad", count: 1, color: "railroad" },
  { type: "property", value: 2, name: "Short Line", count: 1, color: "railroad" },
  { type: "property", value: 2, name: "Electric Company", count: 1, color: "utility" },
  { type: "property", value: 2, name: "Water Works", count: 1, color: "utility" },

  // Wildcards
  { type: "wildcard", value: 0, name: "Wild Card (Any)", count: 2, colors: ["brown", "light_blue", "pink", "orange", "red", "yellow", "green", "dark_blue", "railroad", "utility"] },
  { type: "wildcard", value: 4, name: "Wild Green/Dark Blue", count: 1, colors: ["green", "dark_blue"] },
  { type: "wildcard", value: 3, name: "Wild Light Blue/Brown", count: 1, colors: ["light_blue", "brown"] },
  { type: "wildcard", value: 2, name: "Wild Pink/Orange", count: 2, colors: ["pink", "orange"] },
  { type: "wildcard", value: 4, name: "Wild Red/Yellow", count: 2, colors: ["red", "yellow"] },
  { type: "wildcard", value: 2, name: "Wild Railroad/Utility", count: 1, colors: ["railroad", "utility"] },
  { type: "wildcard", value: 2, name: "Wild Railroad/Green", count: 1, colors: ["railroad", "green"] },
  { type: "wildcard", value: 1, name: "Wild Light Blue/Railroad", count: 1, colors: ["light_blue", "railroad"] },

  // Action cards
  { type: "action", value: 5, name: "Deal Breaker", count: 2, actionType: "deal_breaker" },
  { type: "action", value: 4, name: "Just Say No", count: 3, actionType: "just_say_no" },
  { type: "action", value: 3, name: "Sly Deal", count: 3, actionType: "sly_deal" },
  { type: "action", value: 3, name: "Forced Deal", count: 4, actionType: "forced_deal" },
  { type: "action", value: 3, name: "Debt Collector", count: 3, actionType: "debt_collector" },
  { type: "action", value: 2, name: "It's My Birthday", count: 3, actionType: "its_my_birthday" },
  { type: "action", value: 1, name: "Pass Go", count: 10, actionType: "pass_go" },
  { type: "action", value: 3, name: "House", count: 3, actionType: "house" },
  { type: "action", value: 4, name: "Hotel", count: 3, actionType: "hotel" },
  { type: "action", value: 1, name: "Double The Rent", count: 2, actionType: "double_the_rent" },

  // Rent cards
  { type: "rent", value: 1, name: "Rent (Any Color)", count: 3, colors: ["brown", "light_blue", "pink", "orange", "red", "yellow", "green", "dark_blue", "railroad", "utility"] },
  { type: "rent", value: 1, name: "Rent (Brown/Light Blue)", count: 2, colors: ["brown", "light_blue"] },
  { type: "rent", value: 1, name: "Rent (Pink/Orange)", count: 2, colors: ["pink", "orange"] },
  { type: "rent", value: 1, name: "Rent (Red/Yellow)", count: 2, colors: ["red", "yellow"] },
  { type: "rent", value: 1, name: "Rent (Green/Dark Blue)", count: 2, colors: ["green", "dark_blue"] },
  { type: "rent", value: 1, name: "Rent (Railroad/Utility)", count: 2, colors: ["railroad", "utility"] },
];

type ActionData =
  | { action: "draw" }
  | { action: "play_money"; cardId: string }
  | { action: "play_property"; cardId: string; targetColor?: string }
  | { action: "play_action"; cardId: string; targetPlayerId?: string; targetCardId?: string; offerCardId?: string; targetColor?: string }
  | { action: "pass" }
  | { action: "discard"; cardIds: string[] }
  | { action: "respond"; response: "accept" | "just_say_no"; cardId?: string }
  | { action: "pay"; cardIds: string[] };

export class MonopolyDealRoom extends BaseRoom<MonopolyDealState> {
  maxClients = 4;
  private deck: MonopolyDealCardSchema[] = [];
  private cardIdCounter = 0;

  initializeGame(): void {
    this.setState(new MonopolyDealState());
    this.state.status = "waiting";
    this.state.phase = "draw";
    this.initializeDeck();
  }

  private initializeDeck(): void {
    this.deck = [];
    this.cardIdCounter = 0;

    for (const def of CARD_DEFINITIONS) {
      for (let i = 0; i < def.count; i++) {
        const card = new MonopolyDealCardSchema();
        card.id = `card_${this.cardIdCounter++}`;
        card.cardType = def.type;
        card.value = def.value;
        card.name = def.name;
        if (def.actionType) card.actionType = def.actionType;
        if (def.color) card.color = def.color;
        if (def.colors) {
          for (const c of def.colors) {
            card.colors.push(c);
          }
        }
        if (def.color && RENT_VALUES[def.color]) {
          for (const rv of RENT_VALUES[def.color]) {
            card.rentValues.push(rv);
          }
        }
        this.deck.push(card);
      }
    }

    this.shuffleDeck();
    this.state.deckRemaining = this.deck.length;
  }

  private shuffleDeck(): void {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  private drawCard(): MonopolyDealCardSchema | null {
    if (this.deck.length === 0) {
      // Reshuffle discard pile
      if (this.state.discardPile.length > 0) {
        this.deck = Array.from(this.state.discardPile);
        this.state.discardPile.clear();
        this.shuffleDeck();
      }
    }

    if (this.deck.length === 0) return null;

    const card = this.deck.pop()!;
    this.state.deckRemaining = this.deck.length;
    return card;
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new MonopolyDealPlayerSchema();
    player.id = client.sessionId;
    player.displayName = options.playerName || `Guest_${client.sessionId.slice(0, 4)}`;
    player.isReady = false;
    player.isConnected = true;
    player.joinedAt = Date.now();
    player.actionsRemaining = 3;
    player.completeSets = 0;

    this.state.players.set(client.sessionId, player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, playerName: player.displayName },
      "Player joined Monopoly Deal"
    );

    if (this.clients.length >= this.maxClients) {
      this.lock();
    }
  }

  protected startGame(): void {
    // Deal 5 cards to each player
    for (const [, player] of this.state.players) {
      const p = player as MonopolyDealPlayerSchema;
      for (let i = 0; i < 5; i++) {
        const card = this.drawCard();
        if (card) p.hand.push(card);
      }
    }

    this.state.status = "in_progress";
    this.state.phase = "draw";

    const playerIds = Array.from(this.state.players.keys());
    this.state.currentTurnId = playerIds[0];
    this.state.turnStartedAt = Date.now();

    // Set actions remaining for first player
    const firstPlayer = this.state.players.get(this.state.currentTurnId) as MonopolyDealPlayerSchema;
    firstPlayer.actionsRemaining = 3;

    logger.info({ roomId: this.roomId }, "Monopoly Deal game started");
    this.broadcast("game_started", { firstPlayer: this.state.currentTurnId });
    this.startTurnTimer();
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as ActionData;
    const player = this.state.players.get(client.sessionId) as MonopolyDealPlayerSchema;

    if (!player) {
      client.send("error", { message: "Player not found" });
      return;
    }

    switch (moveData.action) {
      case "draw":
        this.handleDraw(client, player);
        break;
      case "play_money":
        this.handlePlayMoney(client, player, moveData);
        break;
      case "play_property":
        this.handlePlayProperty(client, player, moveData);
        break;
      case "play_action":
        this.handlePlayAction(client, player, moveData);
        break;
      case "pass":
        this.handlePass(client, player);
        break;
      case "discard":
        this.handleDiscard(client, player, moveData);
        break;
      case "respond":
        this.handleRespond(client, player, moveData);
        break;
      case "pay":
        this.handlePay(client, player, moveData);
        break;
      default:
        client.send("error", { message: "Invalid action" });
    }
  }

  private handleDraw(client: Client, player: MonopolyDealPlayerSchema): void {
    if (this.state.phase !== "draw" || this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Cannot draw now" });
      return;
    }

    // Draw 2 cards (or 5 if hand is empty)
    const drawCount = player.hand.length === 0 ? 5 : 2;
    for (let i = 0; i < drawCount; i++) {
      const card = this.drawCard();
      if (card) player.hand.push(card);
    }

    this.state.phase = "play";
    this.broadcast("cards_drawn", { playerId: client.sessionId, count: drawCount });
  }

  private handlePlayMoney(client: Client, player: MonopolyDealPlayerSchema, data: { cardId: string }): void {
    if (this.state.phase !== "play" || player.actionsRemaining <= 0) {
      client.send("error", { message: "Cannot play money now" });
      return;
    }

    let cardIndex = -1;
    for (let i = 0; i < player.hand.length; i++) {
      if (player.hand[i].id === data.cardId) {
        cardIndex = i;
        break;
      }
    }
    if (cardIndex === -1) {
      client.send("error", { message: "Card not found in hand" });
      return;
    }

    const card = player.hand[cardIndex];
    player.hand.splice(cardIndex, 1);
    player.bank.push(card);
    player.actionsRemaining--;

    this.broadcast("money_played", { playerId: client.sessionId, cardId: card.id });
    this.checkEndTurn(client, player);
  }

  private handlePlayProperty(client: Client, player: MonopolyDealPlayerSchema, data: { cardId: string; targetColor?: string }): void {
    if (this.state.phase !== "play" || player.actionsRemaining <= 0) {
      client.send("error", { message: "Cannot play property now" });
      return;
    }

    let cardIndex = -1;
    for (let i = 0; i < player.hand.length; i++) {
      if (player.hand[i].id === data.cardId) {
        cardIndex = i;
        break;
      }
    }
    if (cardIndex === -1) {
      client.send("error", { message: "Card not found in hand" });
      return;
    }

    const card = player.hand[cardIndex];
    if (card.cardType !== "property" && card.cardType !== "wildcard") {
      client.send("error", { message: "Not a property card" });
      return;
    }

    // Determine target color
    let targetColor = card.color;
    if (card.cardType === "wildcard") {
      if (!data.targetColor || !card.colors.includes(data.targetColor)) {
        client.send("error", { message: "Must specify valid color for wildcard" });
        return;
      }
      targetColor = data.targetColor;
    }

    if (!targetColor) {
      client.send("error", { message: "No color specified" });
      return;
    }

    // Find or create property set
    let propertySet: MonopolyDealPropertySetSchema | null = null;
    for (const ps of player.propertySets) {
      if (ps.color === targetColor) {
        propertySet = ps;
        break;
      }
    }
    if (!propertySet) {
      propertySet = new MonopolyDealPropertySetSchema();
      propertySet.color = targetColor;
      player.propertySets.push(propertySet);
    }

    player.hand.splice(cardIndex, 1);
    propertySet.cards.push(card);

    // Check if set is complete
    const required = SET_REQUIREMENTS[targetColor] || 3;
    propertySet.isComplete = propertySet.cards.length >= required;
    if (propertySet.isComplete) {
      this.updateCompleteSets(player);
    }

    player.actionsRemaining--;

    this.broadcast("property_played", { playerId: client.sessionId, cardId: card.id, color: targetColor });
    this.checkEndTurn(client, player);
  }

  private handlePlayAction(client: Client, player: MonopolyDealPlayerSchema, data: { cardId: string; targetPlayerId?: string; targetCardId?: string; offerCardId?: string; targetColor?: string }): void {
    if (this.state.phase !== "play" || player.actionsRemaining <= 0) {
      client.send("error", { message: "Cannot play action now" });
      return;
    }

    let cardIndex = -1;
    for (let i = 0; i < player.hand.length; i++) {
      if (player.hand[i].id === data.cardId) {
        cardIndex = i;
        break;
      }
    }
    if (cardIndex === -1) {
      client.send("error", { message: "Card not found in hand" });
      return;
    }

    const card = player.hand[cardIndex];
    if (card.cardType !== "action" && card.cardType !== "rent") {
      client.send("error", { message: "Not an action card" });
      return;
    }

    // Handle different action types
    switch (card.actionType) {
      case "pass_go":
        this.executePassGo(client, player, card, cardIndex);
        break;
      case "deal_breaker":
        this.initiateDealBreaker(client, player, card, cardIndex, data);
        break;
      case "sly_deal":
        this.initiateSlyDeal(client, player, card, cardIndex, data);
        break;
      case "forced_deal":
        this.initiateForcedDeal(client, player, card, cardIndex, data);
        break;
      case "debt_collector":
        this.initiateDebtCollector(client, player, card, cardIndex, data);
        break;
      case "its_my_birthday":
        this.initiateBirthday(client, player, card, cardIndex);
        break;
      case "house":
        this.executeHouse(client, player, card, cardIndex, data);
        break;
      case "hotel":
        this.executeHotel(client, player, card, cardIndex, data);
        break;
      default:
        if (card.cardType === "rent") {
          this.initiateRent(client, player, card, cardIndex, data);
        } else {
          client.send("error", { message: "Unknown action type" });
        }
    }
  }

  private executePassGo(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number): void {
    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    // Draw 2 cards
    for (let i = 0; i < 2; i++) {
      const drawn = this.drawCard();
      if (drawn) player.hand.push(drawn);
    }

    this.broadcast("pass_go_played", { playerId: client.sessionId });
    this.checkEndTurn(client, player);
  }

  private initiateDealBreaker(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetPlayerId?: string; targetCardId?: string }): void {
    if (!data.targetPlayerId) {
      client.send("error", { message: "Must specify target player" });
      return;
    }

    const targetPlayer = this.state.players.get(data.targetPlayerId) as MonopolyDealPlayerSchema;
    if (!targetPlayer) {
      client.send("error", { message: "Target player not found" });
      return;
    }

    // Find a complete set
    let completeSet: MonopolyDealPropertySetSchema | null = null;
    for (const ps of targetPlayer.propertySets) {
      if (ps.isComplete) {
        completeSet = ps;
        break;
      }
    }
    if (!completeSet) {
      client.send("error", { message: "Target has no complete sets" });
      return;
    }

    // Create action request on stack
    const actionRequest = new MonopolyDealActionRequestSchema();
    actionRequest.id = `action_${Date.now()}`;
    actionRequest.actionType = "deal_breaker";
    actionRequest.sourcePlayerId = client.sessionId;
    actionRequest.targetPlayerId = data.targetPlayerId;
    actionRequest.cardId = card.id;
    actionRequest.payload = JSON.stringify({ targetSetColor: completeSet.color });
    actionRequest.status = "pending";

    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    this.state.actionStack.push(actionRequest);
    this.state.phase = "respond";
    this.state.activeResponderId = data.targetPlayerId;

    this.broadcast("action_initiated", {
      actionType: "deal_breaker",
      sourcePlayerId: client.sessionId,
      targetPlayerId: data.targetPlayerId,
    });
  }

  private initiateSlyDeal(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetPlayerId?: string; targetCardId?: string }): void {
    if (!data.targetPlayerId || !data.targetCardId) {
      client.send("error", { message: "Must specify target player and card" });
      return;
    }

    const targetPlayer = this.state.players.get(data.targetPlayerId) as MonopolyDealPlayerSchema;
    if (!targetPlayer) {
      client.send("error", { message: "Target player not found" });
      return;
    }

    // Find the target card in non-complete sets
    let foundCard: MonopolyDealCardSchema | null = null;
    let foundSetIndex = -1;
    let foundCardIndex = -1;

    for (let si = 0; si < targetPlayer.propertySets.length; si++) {
      const set = targetPlayer.propertySets[si];
      if (set.isComplete) continue; // Cannot steal from complete sets

      for (let ci = 0; ci < set.cards.length; ci++) {
        if (set.cards[ci].id === data.targetCardId) {
          foundCard = set.cards[ci];
          foundSetIndex = si;
          foundCardIndex = ci;
          break;
        }
      }
      if (foundCard) break;
    }

    if (!foundCard) {
      client.send("error", { message: "Cannot steal that card (not found or in complete set)" });
      return;
    }

    const actionRequest = new MonopolyDealActionRequestSchema();
    actionRequest.id = `action_${Date.now()}`;
    actionRequest.actionType = "sly_deal";
    actionRequest.sourcePlayerId = client.sessionId;
    actionRequest.targetPlayerId = data.targetPlayerId;
    actionRequest.cardId = card.id;
    actionRequest.payload = JSON.stringify({ targetCardId: data.targetCardId, setIndex: foundSetIndex, cardIndex: foundCardIndex });
    actionRequest.status = "pending";

    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    this.state.actionStack.push(actionRequest);
    this.state.phase = "respond";
    this.state.activeResponderId = data.targetPlayerId;

    this.broadcast("action_initiated", {
      actionType: "sly_deal",
      sourcePlayerId: client.sessionId,
      targetPlayerId: data.targetPlayerId,
    });
  }

  private initiateForcedDeal(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetPlayerId?: string; targetCardId?: string; offerCardId?: string }): void {
    if (!data.targetPlayerId || !data.targetCardId || !data.offerCardId) {
      client.send("error", { message: "Must specify target player, their card, and your offer card" });
      return;
    }

    // Similar to sly deal but also checks player has an offer card
    // Implementation would validate both cards exist in non-complete sets
    const actionRequest = new MonopolyDealActionRequestSchema();
    actionRequest.id = `action_${Date.now()}`;
    actionRequest.actionType = "forced_deal";
    actionRequest.sourcePlayerId = client.sessionId;
    actionRequest.targetPlayerId = data.targetPlayerId;
    actionRequest.cardId = card.id;
    actionRequest.payload = JSON.stringify({ targetCardId: data.targetCardId, offerCardId: data.offerCardId });
    actionRequest.status = "pending";

    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    this.state.actionStack.push(actionRequest);
    this.state.phase = "respond";
    this.state.activeResponderId = data.targetPlayerId;

    this.broadcast("action_initiated", {
      actionType: "forced_deal",
      sourcePlayerId: client.sessionId,
      targetPlayerId: data.targetPlayerId,
    });
  }

  private initiateDebtCollector(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetPlayerId?: string }): void {
    if (!data.targetPlayerId) {
      client.send("error", { message: "Must specify target player" });
      return;
    }

    const targetPlayer = this.state.players.get(data.targetPlayerId) as MonopolyDealPlayerSchema;
    if (!targetPlayer) {
      client.send("error", { message: "Target player not found" });
      return;
    }

    const actionRequest = new MonopolyDealActionRequestSchema();
    actionRequest.id = `action_${Date.now()}`;
    actionRequest.actionType = "debt_collector";
    actionRequest.sourcePlayerId = client.sessionId;
    actionRequest.targetPlayerId = data.targetPlayerId;
    actionRequest.cardId = card.id;
    actionRequest.amount = 5;
    actionRequest.status = "pending";

    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    this.state.actionStack.push(actionRequest);
    this.state.phase = "respond";
    this.state.activeResponderId = data.targetPlayerId;

    this.broadcast("action_initiated", {
      actionType: "debt_collector",
      sourcePlayerId: client.sessionId,
      targetPlayerId: data.targetPlayerId,
      amount: 5,
    });
  }

  private initiateBirthday(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number): void {
    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    // All other players owe $2M
    for (const [playerId, p] of this.state.players) {
      if (playerId !== client.sessionId) {
        const otherPlayer = p as MonopolyDealPlayerSchema;
        otherPlayer.amountOwed = 2;
        otherPlayer.owedToPlayerId = client.sessionId;
      }
    }

    this.state.phase = "pay";
    this.broadcast("birthday_played", { playerId: client.sessionId });
  }

  private initiateRent(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetColor?: string }): void {
    if (!data.targetColor) {
      client.send("error", { message: "Must specify color to charge rent on" });
      return;
    }

    // Check player has properties of that color
    let rentPropertySet: MonopolyDealPropertySetSchema | null = null;
    for (const ps of player.propertySets) {
      if (ps.color === data.targetColor) {
        rentPropertySet = ps;
        break;
      }
    }
    if (!rentPropertySet || rentPropertySet.cards.length === 0) {
      client.send("error", { message: "You have no properties of that color" });
      return;
    }

    // Calculate rent amount
    const rentValues = RENT_VALUES[data.targetColor] || [1, 2, 3];
    const setSize = Math.min(rentPropertySet.cards.length, rentValues.length);
    let rentAmount = rentValues[setSize - 1] || 1;

    // Add house/hotel bonus
    if (rentPropertySet.hasHouse) rentAmount += 3;
    if (rentPropertySet.hasHotel) rentAmount += 4;

    player.hand.splice(cardIndex, 1);
    this.state.discardPile.push(card);
    player.actionsRemaining--;

    // All other players owe rent
    for (const [playerId, p] of this.state.players) {
      if (playerId !== client.sessionId) {
        const otherPlayer = p as MonopolyDealPlayerSchema;
        otherPlayer.amountOwed = rentAmount;
        otherPlayer.owedToPlayerId = client.sessionId;
      }
    }

    this.state.phase = "pay";
    this.broadcast("rent_charged", { playerId: client.sessionId, color: data.targetColor, amount: rentAmount });
  }

  private executeHouse(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetColor?: string }): void {
    if (!data.targetColor) {
      client.send("error", { message: "Must specify which complete set to add house to" });
      return;
    }

    let houseSet: MonopolyDealPropertySetSchema | null = null;
    for (const ps of player.propertySets) {
      if (ps.color === data.targetColor && ps.isComplete) {
        houseSet = ps;
        break;
      }
    }
    if (!houseSet) {
      client.send("error", { message: "No complete set of that color" });
      return;
    }

    if (houseSet.hasHouse) {
      client.send("error", { message: "Set already has a house" });
      return;
    }

    player.hand.splice(cardIndex, 1);
    houseSet.hasHouse = true;
    player.actionsRemaining--;

    this.broadcast("house_added", { playerId: client.sessionId, color: data.targetColor });
    this.checkEndTurn(client, player);
  }

  private executeHotel(client: Client, player: MonopolyDealPlayerSchema, card: MonopolyDealCardSchema, cardIndex: number, data: { targetColor?: string }): void {
    if (!data.targetColor) {
      client.send("error", { message: "Must specify which set with house to add hotel to" });
      return;
    }

    let hotelSet: MonopolyDealPropertySetSchema | null = null;
    for (const ps of player.propertySets) {
      if (ps.color === data.targetColor && ps.isComplete && ps.hasHouse) {
        hotelSet = ps;
        break;
      }
    }
    if (!hotelSet) {
      client.send("error", { message: "No complete set with house of that color" });
      return;
    }

    if (hotelSet.hasHotel) {
      client.send("error", { message: "Set already has a hotel" });
      return;
    }

    player.hand.splice(cardIndex, 1);
    hotelSet.hasHotel = true;
    player.actionsRemaining--;

    this.broadcast("hotel_added", { playerId: client.sessionId, color: data.targetColor });
    this.checkEndTurn(client, player);
  }

  private handlePass(client: Client, player: MonopolyDealPlayerSchema): void {
    if (this.state.phase !== "play") {
      client.send("error", { message: "Cannot pass now" });
      return;
    }

    player.actionsRemaining = 0;
    this.checkEndTurn(client, player);
  }

  private handleDiscard(client: Client, player: MonopolyDealPlayerSchema, data: { cardIds: string[] }): void {
    if (this.state.phase !== "discard") {
      client.send("error", { message: "Not in discard phase" });
      return;
    }

    // Must discard down to 7 cards
    const targetHandSize = 7;
    const toDiscard = player.hand.length - targetHandSize;

    if (data.cardIds.length !== toDiscard) {
      client.send("error", { message: `Must discard exactly ${toDiscard} cards` });
      return;
    }

    for (const cardId of data.cardIds) {
      const idx = Array.from(player.hand).findIndex(c => c.id === cardId);
      if (idx !== -1) {
        const card = player.hand[idx];
        player.hand.splice(idx, 1);
        this.state.discardPile.push(card);
      }
    }

    this.broadcast("cards_discarded", { playerId: client.sessionId, count: data.cardIds.length });
    this.endTurn(client.sessionId);
  }

  private handleRespond(client: Client, player: MonopolyDealPlayerSchema, data: { response: "accept" | "just_say_no"; cardId?: string }): void {
    if (this.state.phase !== "respond" || this.state.activeResponderId !== client.sessionId) {
      client.send("error", { message: "Not your turn to respond" });
      return;
    }

    const currentAction = this.state.actionStack[this.state.actionStack.length - 1];
    if (!currentAction) {
      client.send("error", { message: "No action to respond to" });
      return;
    }

    if (data.response === "just_say_no") {
      // Check player has Just Say No card
      const jsnIndex = Array.from(player.hand).findIndex(c => c.actionType === "just_say_no");
      if (jsnIndex === -1) {
        client.send("error", { message: "You don't have a Just Say No card" });
        return;
      }

      const jsnCard = player.hand[jsnIndex];
      player.hand.splice(jsnIndex, 1);
      this.state.discardPile.push(jsnCard);

      // Create counter-action on stack
      const counterAction = new MonopolyDealActionRequestSchema();
      counterAction.id = `action_${Date.now()}`;
      counterAction.actionType = "just_say_no";
      counterAction.sourcePlayerId = client.sessionId;
      counterAction.targetPlayerId = currentAction.sourcePlayerId;
      counterAction.cardId = jsnCard.id;
      counterAction.status = "pending";

      this.state.actionStack.push(counterAction);
      this.state.activeResponderId = currentAction.sourcePlayerId;

      this.broadcast("just_say_no_played", {
        sourcePlayerId: client.sessionId,
        targetPlayerId: currentAction.sourcePlayerId,
      });
    } else {
      // Accept the action
      this.resolveActionStack();
    }
  }

  private handlePay(client: Client, player: MonopolyDealPlayerSchema, data: { cardIds: string[] }): void {
    if (player.amountOwed <= 0) {
      client.send("error", { message: "You don't owe anything" });
      return;
    }

    // Calculate total value of payment
    let totalValue = 0;
    const cardsToMove: { card: MonopolyDealCardSchema; source: "bank" | "property"; setIndex?: number; cardIndex?: number }[] = [];

    for (const cardId of data.cardIds) {
      // Check bank first
      const bankIdx = Array.from(player.bank).findIndex(c => c.id === cardId);
      if (bankIdx !== -1) {
        totalValue += player.bank[bankIdx].value;
        cardsToMove.push({ card: player.bank[bankIdx], source: "bank" });
        continue;
      }

      // Check property sets
      for (let si = 0; si < player.propertySets.length; si++) {
        const set = player.propertySets[si];
        for (let ci = 0; ci < set.cards.length; ci++) {
          if (set.cards[ci].id === cardId) {
            totalValue += set.cards[ci].value;
            cardsToMove.push({ card: set.cards[ci], source: "property", setIndex: si, cardIndex: ci });
            break;
          }
        }
      }
    }

    if (totalValue < player.amountOwed && this.getTotalAssets(player) > totalValue) {
      client.send("error", { message: "Payment insufficient. Must pay at least the owed amount." });
      return;
    }

    // Execute the payment
    const creditor = this.state.players.get(player.owedToPlayerId) as MonopolyDealPlayerSchema;

    for (const item of cardsToMove) {
      if (item.source === "bank") {
        const idx = Array.from(player.bank).findIndex(c => c.id === item.card.id);
        if (idx !== -1) player.bank.splice(idx, 1);
        creditor.bank.push(item.card);
      } else if (item.source === "property" && item.setIndex !== undefined) {
        const set = player.propertySets[item.setIndex];
        const idx = Array.from(set.cards).findIndex(c => c.id === item.card.id);
        if (idx !== -1) set.cards.splice(idx, 1);
        
        // Add to creditor's properties
        let creditorSet = Array.from(creditor.propertySets).find(ps => ps.color === item.card.color);
        if (!creditorSet) {
          creditorSet = new MonopolyDealPropertySetSchema();
          creditorSet.color = item.card.color;
          creditor.propertySets.push(creditorSet);
        }
        creditorSet.cards.push(item.card);
        this.updateSetCompletion(creditorSet);
      }
    }

    player.amountOwed = 0;
    player.owedToPlayerId = "";

    // Update complete sets counts
    this.updateCompleteSets(player);
    this.updateCompleteSets(creditor);

    this.broadcast("payment_made", { 
      fromPlayerId: client.sessionId, 
      toPlayerId: creditor.id, 
      amount: totalValue 
    });

    // Check if all debts are paid
    const anyDebtRemaining = Array.from(this.state.players.values()).some(
      p => (p as MonopolyDealPlayerSchema).amountOwed > 0
    );

    if (!anyDebtRemaining) {
      const currentPlayer = this.state.players.get(this.state.currentTurnId) as MonopolyDealPlayerSchema;
      this.checkEndTurn(this.clients.find(c => c.sessionId === this.state.currentTurnId)!, currentPlayer);
    }
  }

  private resolveActionStack(): void {
    // Resolve actions from top to bottom (LIFO)
    while (this.state.actionStack.length > 0) {
      const action = this.state.actionStack[this.state.actionStack.length - 1];

      // Check if this action is countered by a Just Say No above it
      let isCancelled = false;
      for (let i = this.state.actionStack.length - 1; i >= 0; i--) {
        const a = this.state.actionStack[i];
        if (a.actionType === "just_say_no" && a.targetPlayerId === action.sourcePlayerId) {
          // This action is cancelled
          isCancelled = !isCancelled;
        }
      }

      if (!isCancelled && action.actionType !== "just_say_no") {
        this.executeAction(action);
      }

      this.state.actionStack.pop();
    }

    this.state.activeResponderId = "";

    // Return to play phase or check for turn end
    const currentPlayer = this.state.players.get(this.state.currentTurnId) as MonopolyDealPlayerSchema;
    const currentClient = this.clients.find(c => c.sessionId === this.state.currentTurnId);
    if (currentClient) {
      this.state.phase = "play";
      this.checkEndTurn(currentClient, currentPlayer);
    }
  }

  private executeAction(action: MonopolyDealActionRequestSchema): void {
    const sourcePlayer = this.state.players.get(action.sourcePlayerId) as MonopolyDealPlayerSchema;
    const targetPlayer = this.state.players.get(action.targetPlayerId) as MonopolyDealPlayerSchema;

    if (!sourcePlayer || !targetPlayer) return;

    const payload = JSON.parse(action.payload || "{}");

    switch (action.actionType) {
      case "deal_breaker": {
        const targetColor = payload.targetSetColor;
        const setIndex = Array.from(targetPlayer.propertySets).findIndex(ps => ps.color === targetColor && ps.isComplete);
        if (setIndex !== -1) {
          const stolenSet = targetPlayer.propertySets[setIndex];
          targetPlayer.propertySets.splice(setIndex, 1);

          // Create new set for source player
          const newSet = new MonopolyDealPropertySetSchema();
          newSet.color = stolenSet.color;
          newSet.isComplete = stolenSet.isComplete;
          newSet.hasHouse = stolenSet.hasHouse;
          newSet.hasHotel = stolenSet.hasHotel;
          for (const card of stolenSet.cards) {
            newSet.cards.push(card);
          }
          sourcePlayer.propertySets.push(newSet);

          this.updateCompleteSets(sourcePlayer);
          this.updateCompleteSets(targetPlayer);
        }
        break;
      }
      case "sly_deal": {
        const { setIndex, cardIndex } = payload;
        if (setIndex !== undefined && cardIndex !== undefined) {
          const set = targetPlayer.propertySets[setIndex];
          if (set && set.cards[cardIndex]) {
            const stolenCard = set.cards[cardIndex];
            set.cards.splice(cardIndex, 1);

            // Add to source player's properties
            let destSet = Array.from(sourcePlayer.propertySets).find(ps => ps.color === stolenCard.color);
            if (!destSet) {
              destSet = new MonopolyDealPropertySetSchema();
              destSet.color = stolenCard.color;
              sourcePlayer.propertySets.push(destSet);
            }
            destSet.cards.push(stolenCard);
            this.updateSetCompletion(destSet);
            this.updateSetCompletion(set);
          }
        }
        break;
      }
      case "debt_collector": {
        targetPlayer.amountOwed = action.amount;
        targetPlayer.owedToPlayerId = action.sourcePlayerId;
        this.state.phase = "pay";
        break;
      }
    }
  }

  private getTotalAssets(player: MonopolyDealPlayerSchema): number {
    let total = 0;
    for (const card of player.bank) {
      total += card.value;
    }
    for (const set of player.propertySets) {
      for (const card of set.cards) {
        total += card.value;
      }
    }
    return total;
  }

  private updateSetCompletion(set: MonopolyDealPropertySetSchema): void {
    const required = SET_REQUIREMENTS[set.color] || 3;
    set.isComplete = set.cards.length >= required;
  }

  private updateCompleteSets(player: MonopolyDealPlayerSchema): void {
    let count = 0;
    for (const set of player.propertySets) {
      const required = SET_REQUIREMENTS[set.color] || 3;
      set.isComplete = set.cards.length >= required;
      if (set.isComplete) count++;
    }
    player.completeSets = count;
  }

  private checkEndTurn(client: Client, player: MonopolyDealPlayerSchema): void {
    // Check win condition
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }

    // If no actions remaining or passed, check for discard
    if (player.actionsRemaining <= 0 || this.state.phase === "play") {
      if (player.hand.length > 7) {
        this.state.phase = "discard";
        this.broadcast("must_discard", { playerId: client.sessionId, count: player.hand.length - 7 });
      } else if (player.actionsRemaining <= 0) {
        this.endTurn(client.sessionId);
      }
    }
  }

  private endTurn(playerId: string): void {
    this.state.phase = "draw";
    this.state.activeResponderId = "";
    this.state.actionStack.clear();

    // Clear any debts
    for (const [, p] of this.state.players) {
      const player = p as MonopolyDealPlayerSchema;
      player.amountOwed = 0;
      player.owedToPlayerId = "";
    }

    this.nextTurn();

    // Set up next player
    const nextPlayer = this.state.players.get(this.state.currentTurnId) as MonopolyDealPlayerSchema;
    nextPlayer.actionsRemaining = 3;

    this.broadcast("turn_ended", { playerId });
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    for (const [playerId, player] of this.state.players) {
      const p = player as MonopolyDealPlayerSchema;
      if (p.completeSets >= this.state.setsToWin) {
        return { winner: playerId, isDraw: false };
      }
    }
    return null;
  }
}
