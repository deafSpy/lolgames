import { BotAgent, BotConfig } from "./BotAgent.js";

type GemType = "white" | "blue" | "green" | "red" | "black";

interface SplendorCard {
  id: string;
  tier: number;
  gemType: GemType;
  points: number;
  costWhite: number;
  costBlue: number;
  costGreen: number;
  costRed: number;
  costBlack: number;
}

interface SplendorNoble {
  id: string;
  points: number;
  reqWhite: number;
  reqBlue: number;
  reqGreen: number;
  reqRed: number;
  reqBlack: number;
}

interface SplendorPlayerState {
  id: string;
  gemWhite: number;
  gemBlue: number;
  gemGreen: number;
  gemRed: number;
  gemBlack: number;
  gemGold: number;
  points: number;
  cards: SplendorCard[];
  reservedCards: SplendorCard[];
}

interface SplendorGameState {
  bankWhite: number;
  bankBlue: number;
  bankGreen: number;
  bankRed: number;
  bankBlack: number;
  bankGold: number;
  tier1Cards: SplendorCard[];
  tier2Cards: SplendorCard[];
  tier3Cards: SplendorCard[];
  nobles: SplendorNoble[];
  players: Map<string, SplendorPlayerState>;
  currentTurnId: string;
  phase: string;
}

/**
 * Splendor Bot - uses a greedy strategy to buy cards and collect gems
 * Strategy:
 * 1. If can buy a card with points, buy it
 * 2. If can buy a card that helps toward a noble, buy it
 * 3. If have reserved cards we can buy, buy them
 * 4. Take gems that help buy available cards
 * 5. Reserve high-value cards if hand allows
 */
export class SplendorBot extends BotAgent {
  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, {
      ...config,
      thinkingDelay: config.thinkingDelay || 1000,
    });
  }

  calculateMove(gameState: SplendorGameState): unknown {
    const player = gameState.players.get(this.playerId);
    if (!player) {
      return { action: "take_gems", gems: {} };
    }

    // Handle discard phase
    if (gameState.phase === "discard_gems") {
      return this.handleDiscardGems(player);
    }

    // Handle noble selection
    if (gameState.phase === "select_noble") {
      return this.handleSelectNoble(gameState, player);
    }

    // Get all available cards
    const allCards = [
      ...gameState.tier1Cards,
      ...gameState.tier2Cards,
      ...gameState.tier3Cards,
    ];

    // Get player's gem bonuses from cards
    const bonuses = this.getCardBonuses(player);
    const totalGems = this.getTotalGems(player);

    // Strategy 1: Buy cards with points first
    const buyableWithPoints = allCards
      .filter(card => card.points > 0 && this.canAfford(card, player, bonuses))
      .sort((a, b) => b.points - a.points);

    if (buyableWithPoints.length > 0) {
      const best = buyableWithPoints[0];
      return {
        action: "buy_card",
        cardId: best.id,
        tier: best.tier,
      };
    }

    // Strategy 2: Buy reserved cards if affordable
    const buyableReserved = player.reservedCards
      .filter(card => this.canAfford(card, player, bonuses))
      .sort((a, b) => b.points - a.points);

    if (buyableReserved.length > 0) {
      return {
        action: "buy_card",
        cardId: buyableReserved[0].id,
      };
    }

    // Strategy 3: Buy cards that help toward nobles
    const buyableCards = allCards.filter(card => this.canAfford(card, player, bonuses));
    if (buyableCards.length > 0) {
      // Prefer cards that help us get nobles
      const nobleHelpful = buyableCards.filter(card =>
        gameState.nobles.some(noble => this.cardHelpsNoble(card, noble, bonuses))
      );
      if (nobleHelpful.length > 0) {
        return {
          action: "buy_card",
          cardId: nobleHelpful[0].id,
          tier: nobleHelpful[0].tier,
        };
      }
    }

    // Strategy 4: Take gems
    if (totalGems < 10) {
      const gemsToTake = this.selectGemsToTake(gameState, player, allCards, bonuses);
      if (Object.keys(gemsToTake).length > 0) {
        return {
          action: "take_gems",
          gems: gemsToTake,
        };
      }
    }

    // Strategy 5: Reserve a high-value card
    if (player.reservedCards.length < 3) {
      const tier3Available = gameState.tier3Cards.filter(c => c.points >= 3);
      if (tier3Available.length > 0) {
        return {
          action: "reserve_card",
          cardId: tier3Available[0].id,
          tier: 3,
        };
      }
    }

    // Fallback: take any available gems
    const availableGems: Partial<Record<GemType, number>> = {};
    const gemTypes: GemType[] = ["white", "blue", "green", "red", "black"];
    let count = 0;

    for (const gem of gemTypes) {
      if (count >= 3) break;
      const bankKey = `bank${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof SplendorGameState;
      if ((gameState[bankKey] as number) > 0) {
        availableGems[gem] = 1;
        count++;
      }
    }

    return {
      action: "take_gems",
      gems: availableGems,
    };
  }

  private handleDiscardGems(player: SplendorPlayerState): unknown {
    const totalGems = this.getTotalGems(player);
    const excess = totalGems - 10;

    if (excess <= 0) {
      return { action: "discard_gems", gems: {} };
    }

    // Discard gems we have the most of
    const gems: Partial<Record<GemType | "gold", number>> = {};
    const gemCounts: Array<[GemType | "gold", number]> = [
      ["white", player.gemWhite],
      ["blue", player.gemBlue],
      ["green", player.gemGreen],
      ["red", player.gemRed],
      ["black", player.gemBlack],
      ["gold", player.gemGold],
    ];

    // Sort by count descending
    gemCounts.sort((a, b) => b[1] - a[1]);

    let remaining = excess;
    for (const [gem, count] of gemCounts) {
      if (remaining <= 0) break;
      const toDiscard = Math.min(count, remaining);
      if (toDiscard > 0) {
        gems[gem] = toDiscard;
        remaining -= toDiscard;
      }
    }

    return { action: "discard_gems", gems };
  }

  private handleSelectNoble(gameState: SplendorGameState, player: SplendorPlayerState): unknown {
    const bonuses = this.getCardBonuses(player);
    
    // Find noble we qualify for
    for (const noble of gameState.nobles) {
      if (this.qualifiesForNoble(noble, bonuses)) {
        return { action: "select_noble", nobleId: noble.id };
      }
    }

    return { action: "select_noble", nobleId: gameState.nobles[0]?.id };
  }

  private getCardBonuses(player: SplendorPlayerState): Record<GemType, number> {
    const bonuses: Record<GemType, number> = {
      white: 0,
      blue: 0,
      green: 0,
      red: 0,
      black: 0,
    };

    for (const card of player.cards) {
      bonuses[card.gemType]++;
    }

    return bonuses;
  }

  private getTotalGems(player: SplendorPlayerState): number {
    return (
      player.gemWhite +
      player.gemBlue +
      player.gemGreen +
      player.gemRed +
      player.gemBlack +
      player.gemGold
    );
  }

  private canAfford(
    card: SplendorCard,
    player: SplendorPlayerState,
    bonuses: Record<GemType, number>
  ): boolean {
    let goldNeeded = 0;

    const costs: Array<[GemType, number, number, number]> = [
      ["white", card.costWhite, player.gemWhite, bonuses.white],
      ["blue", card.costBlue, player.gemBlue, bonuses.blue],
      ["green", card.costGreen, player.gemGreen, bonuses.green],
      ["red", card.costRed, player.gemRed, bonuses.red],
      ["black", card.costBlack, player.gemBlack, bonuses.black],
    ];

    for (const [, cost, gems, bonus] of costs) {
      const effectiveCost = Math.max(0, cost - bonus);
      if (gems < effectiveCost) {
        goldNeeded += effectiveCost - gems;
      }
    }

    return goldNeeded <= player.gemGold;
  }

  private cardHelpsNoble(
    card: SplendorCard,
    noble: SplendorNoble,
    currentBonuses: Record<GemType, number>
  ): boolean {
    const reqKey = `req${card.gemType.charAt(0).toUpperCase() + card.gemType.slice(1)}` as keyof SplendorNoble;
    const required = noble[reqKey] as number;
    const current = currentBonuses[card.gemType];
    return required > 0 && current < required;
  }

  private qualifiesForNoble(noble: SplendorNoble, bonuses: Record<GemType, number>): boolean {
    return (
      bonuses.white >= noble.reqWhite &&
      bonuses.blue >= noble.reqBlue &&
      bonuses.green >= noble.reqGreen &&
      bonuses.red >= noble.reqRed &&
      bonuses.black >= noble.reqBlack
    );
  }

  private selectGemsToTake(
    gameState: SplendorGameState,
    player: SplendorPlayerState,
    allCards: SplendorCard[],
    bonuses: Record<GemType, number>
  ): Partial<Record<GemType, number>> {
    // Find the most needed gems based on cards we almost can afford
    const gemNeeds: Record<GemType, number> = {
      white: 0,
      blue: 0,
      green: 0,
      red: 0,
      black: 0,
    };

    for (const card of allCards) {
      if (card.points > 0 || this.getTotalCost(card) <= 6) {
        this.addGemNeeds(card, player, bonuses, gemNeeds);
      }
    }

    // Sort gems by need
    const gemTypes: GemType[] = ["white", "blue", "green", "red", "black"];
    const sortedGems = gemTypes
      .filter(gem => {
        const bankKey = `bank${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof SplendorGameState;
        return (gameState[bankKey] as number) > 0;
      })
      .sort((a, b) => gemNeeds[b] - gemNeeds[a]);

    const result: Partial<Record<GemType, number>> = {};
    
    // Take 3 different gems or 2 of the same
    if (sortedGems.length >= 3) {
      // Take 3 different
      for (let i = 0; i < 3; i++) {
        result[sortedGems[i]] = 1;
      }
    } else if (sortedGems.length > 0) {
      // Take 2 of the same if bank has 4+
      const bankKey = `bank${sortedGems[0].charAt(0).toUpperCase() + sortedGems[0].slice(1)}` as keyof SplendorGameState;
      if ((gameState[bankKey] as number) >= 4) {
        result[sortedGems[0]] = 2;
      } else {
        for (const gem of sortedGems) {
          result[gem] = 1;
        }
      }
    }

    return result;
  }

  private addGemNeeds(
    card: SplendorCard,
    player: SplendorPlayerState,
    bonuses: Record<GemType, number>,
    needs: Record<GemType, number>
  ): void {
    const costs: Array<[GemType, number, number, number]> = [
      ["white", card.costWhite, player.gemWhite, bonuses.white],
      ["blue", card.costBlue, player.gemBlue, bonuses.blue],
      ["green", card.costGreen, player.gemGreen, bonuses.green],
      ["red", card.costRed, player.gemRed, bonuses.red],
      ["black", card.costBlack, player.gemBlack, bonuses.black],
    ];

    for (const [gem, cost, gems, bonus] of costs) {
      const effectiveCost = Math.max(0, cost - bonus);
      const needed = Math.max(0, effectiveCost - gems);
      needs[gem] += needed;
    }
  }

  private getTotalCost(card: SplendorCard): number {
    return card.costWhite + card.costBlue + card.costGreen + card.costRed + card.costBlack;
  }
}
