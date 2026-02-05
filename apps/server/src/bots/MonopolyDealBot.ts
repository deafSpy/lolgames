import { BotAgent, BotConfig } from "./BotAgent.js";

interface MonopolyDealCard {
  id: string;
  cardType: string; // "money" | "property" | "wildcard" | "action" | "rent"
  value: number;
  name: string;
  actionType?: string;
  color?: string;
  colors?: string[];
}

interface MonopolyDealPropertySet {
  id: string;
  color: string;
  cards: MonopolyDealCard[];
  isComplete: boolean;
  hasHouse: boolean;
  hasHotel: boolean;
}

interface MonopolyDealActionRequest {
  id: string;
  type: string;
  sourcePlayerId: string;
  targetPlayerId: string;
  amount: number;
  resolved: boolean;
  cardId?: string;
}

interface MonopolyDealPlayer {
  id: string;
  hand: MonopolyDealCard[];
  bank: MonopolyDealCard[];
  propertySets: MonopolyDealPropertySet[];
  actionsRemaining: number;
}

interface MonopolyDealGameState {
  phase: string;
  currentTurnId: string;
  players: Map<string, MonopolyDealPlayer>;
  actionStack: MonopolyDealActionRequest[];
  activeResponderId: string;
  discardPile: MonopolyDealCard[];
}

/**
 * Monopoly Deal Bot - uses a heuristic strategy
 * Strategy:
 * 1. Draw phase: always draw
 * 2. Play phase: prioritize completing property sets
 * 3. Action cards: play Deal Breaker if opponent has complete set
 * 4. Response phase: play Just Say No if valuable cards at stake
 * 5. Payment phase: pay with smallest value cards first
 */
export class MonopolyDealBot extends BotAgent {
  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, {
      ...config,
      thinkingDelay: config.thinkingDelay || 800,
    });
  }

  calculateMove(gameState: MonopolyDealGameState): unknown {
    const player = gameState.players.get(this.playerId);
    if (!player) {
      return { type: "pass" };
    }

    // Handle response phase (Just Say No or payment)
    if (gameState.phase === "response" && gameState.activeResponderId === this.playerId) {
      return this.handleResponsePhase(gameState, player);
    }

    // Handle draw phase
    if (gameState.phase === "draw") {
      return { type: "draw" };
    }

    // Handle play phase
    if (gameState.phase === "play") {
      return this.handlePlayPhase(gameState, player);
    }

    return { type: "pass" };
  }

  private handleResponsePhase(
    gameState: MonopolyDealGameState,
    player: MonopolyDealPlayer
  ): unknown {
    const activeAction = gameState.actionStack[gameState.actionStack.length - 1];
    if (!activeAction) {
      return { type: "respond", response: "accept" };
    }

    // Check if we have Just Say No
    const justSayNo = player.hand.find(
      c => c.actionType === "just_say_no"
    );

    // Use Just Say No for high-value actions
    if (justSayNo && this.shouldUseJustSayNo(activeAction, player)) {
      return {
        type: "respond",
        response: "just_say_no",
        cardId: justSayNo.id,
      };
    }

    // Payment required - select cards to pay
    if (activeAction.amount > 0) {
      return this.handlePayment(player, activeAction.amount);
    }

    // Accept the action
    return { type: "respond", response: "accept" };
  }

  private shouldUseJustSayNo(action: MonopolyDealActionRequest, player: MonopolyDealPlayer): boolean {
    // Always block Deal Breaker if we have complete sets
    if (action.type === "deal_breaker") {
      return player.propertySets.some(ps => ps.isComplete);
    }

    // Block Sly Deal if targeting valuable property
    if (action.type === "sly_deal") {
      return true;
    }

    // Block high rent amounts
    if (action.type === "rent" && action.amount >= 5) {
      return true;
    }

    return false;
  }

  private handlePayment(player: MonopolyDealPlayer, amount: number): unknown {
    const selectedCards: string[] = [];
    let total = 0;

    // Collect from bank first, smallest values first
    const bankCards = [...player.bank].sort((a, b) => a.value - b.value);
    for (const card of bankCards) {
      if (total >= amount) break;
      selectedCards.push(card.id);
      total += card.value;
    }

    // If still not enough, add properties (non-complete sets first)
    if (total < amount) {
      const nonCompleteProps = player.propertySets
        .filter(ps => !ps.isComplete)
        .flatMap(ps => ps.cards);
      
      for (const card of nonCompleteProps) {
        if (total >= amount) break;
        selectedCards.push(card.id);
        total += card.value;
      }
    }

    return {
      type: "respond",
      response: "pay",
      cardIds: selectedCards,
    };
  }

  private handlePlayPhase(
    gameState: MonopolyDealGameState,
    player: MonopolyDealPlayer
  ): unknown {
    if (player.actionsRemaining <= 0) {
      return { type: "pass" };
    }

    // Priority 1: Play Deal Breaker if opponent has complete set
    const dealBreaker = player.hand.find(c => c.actionType === "deal_breaker");
    if (dealBreaker) {
      const targetSet = this.findTargetCompleteSet(gameState, player);
      if (targetSet) {
        return {
          type: "action",
          cardIndex: player.hand.findIndex(c => c.id === dealBreaker.id),
          targetPlayerId: targetSet.playerId,
          targetSetId: targetSet.setId,
        };
      }
    }

    // Priority 2: Play money cards
    const moneyCard = player.hand.find(c => c.cardType === "money");
    if (moneyCard) {
      return {
        type: "money",
        cardIndex: player.hand.findIndex(c => c.id === moneyCard.id),
      };
    }

    // Priority 3: Play property cards
    const propertyCard = player.hand.find(c => c.cardType === "property");
    if (propertyCard) {
      return {
        type: "property",
        cardIndex: player.hand.findIndex(c => c.id === propertyCard.id),
        targetColor: propertyCard.color,
      };
    }

    // Priority 4: Play wildcard to help complete a set
    const wildcard = player.hand.find(c => c.cardType === "wildcard");
    if (wildcard && wildcard.colors && wildcard.colors.length > 0) {
      // Choose color that helps us most
      const bestColor = this.findBestColorForWildcard(player, wildcard.colors);
      return {
        type: "property",
        cardIndex: player.hand.findIndex(c => c.id === wildcard.id),
        targetColor: bestColor,
      };
    }

    // Priority 5: Play rent if we have matching property set
    const rentCard = player.hand.find(c => c.cardType === "rent");
    if (rentCard) {
      const matchingSet = player.propertySets.find(
        ps => ps.color === rentCard.color && ps.cards.length > 0
      );
      if (matchingSet) {
        const target = this.findRichestOpponent(gameState, player);
        if (target) {
          return {
            type: "action",
            cardIndex: player.hand.findIndex(c => c.id === rentCard.id),
            targetPlayerId: target,
            targetColor: matchingSet.color,
          };
        }
      }
    }

    // Priority 6: Play Pass Go
    const passGo = player.hand.find(c => c.actionType === "pass_go");
    if (passGo) {
      return {
        type: "action",
        cardIndex: player.hand.findIndex(c => c.id === passGo.id),
      };
    }

    // If we have more than 7 cards, play actions as money
    if (player.hand.length > 7) {
      const actionCard = player.hand.find(c => c.cardType === "action" && c.value > 0);
      if (actionCard) {
        return {
          type: "money",
          cardIndex: player.hand.findIndex(c => c.id === actionCard.id),
        };
      }
    }

    // Pass if nothing good to do
    return { type: "pass" };
  }

  private findTargetCompleteSet(
    gameState: MonopolyDealGameState,
    player: MonopolyDealPlayer
  ): { playerId: string; setId: string } | null {
    for (const [playerId, opponent] of gameState.players) {
      if (playerId === this.playerId) continue;
      
      const completeSet = opponent.propertySets.find(ps => ps.isComplete);
      if (completeSet) {
        return { playerId, setId: completeSet.id };
      }
    }
    return null;
  }

  private findBestColorForWildcard(player: MonopolyDealPlayer, colors: string[]): string {
    // Find color where we have the most cards
    let bestColor = colors[0];
    let maxCards = 0;

    for (const color of colors) {
      const set = player.propertySets.find(ps => ps.color === color);
      const cardCount = set ? set.cards.length : 0;
      if (cardCount > maxCards) {
        maxCards = cardCount;
        bestColor = color;
      }
    }

    return bestColor;
  }

  private findRichestOpponent(
    gameState: MonopolyDealGameState,
    player: MonopolyDealPlayer
  ): string | null {
    let richest: string | null = null;
    let maxValue = 0;

    for (const [playerId, opponent] of gameState.players) {
      if (playerId === this.playerId) continue;
      
      const bankValue = opponent.bank.reduce((sum, c) => sum + c.value, 0);
      if (bankValue > maxValue) {
        maxValue = bankValue;
        richest = playerId;
      }
    }

    return richest;
  }
}
