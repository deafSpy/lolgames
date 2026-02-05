import { BotAgent, BotConfig } from "./BotAgent.js";

interface BlackjackCard {
  suit: string;
  rank: string;
  value: number;
  hidden: boolean;
}

interface BlackjackHand {
  id: string;
  cards: BlackjackCard[];
  bet: number;
  value: number;
  isBusted: boolean;
  isBlackjack: boolean;
  isStanding: boolean;
  isDoubledDown: boolean;
  isSplit: boolean;
  insuranceBet: number;
  result: string;
}

interface BlackjackPlayer {
  id: string;
  chips: number;
  hands: BlackjackHand[];
  currentBet: number;
  isSecretBet: boolean;
  hasBet: boolean;
  isEliminated: boolean;
  handsWon: number;
  handsLost: number;
  handsPushed: number;
}

interface BlackjackGameState {
  phase: string;
  currentTurnId: string;
  players: Map<string, BlackjackPlayer>;
  dealerHand: BlackjackCard[];
  dealerValue: number;
  handNumber: number;
  eliminationHands: number[];
  minBet: number;
  maxBet: number;
  currentBettorId: string;
  currentHandIndex: number;
}

/**
 * Blackjack Bot - uses basic strategy with tournament awareness
 * Strategy:
 * - Betting: Kelly criterion-inspired sizing based on position
 * - Playing: Basic strategy (hit/stand based on dealer upcard)
 * - Doubling: Only on 10/11 vs weak dealer cards
 * - Splitting: Only pairs of A/8
 * - Insurance: Never (basic strategy)
 */
export class BlackjackBot extends BotAgent {
  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, {
      ...config,
      thinkingDelay: config.thinkingDelay || 600,
    });
  }

  calculateMove(gameState: BlackjackGameState): unknown {
    const player = gameState.players.get(this.playerId);
    if (!player) {
      return { action: "stand" };
    }

    // Handle betting phase
    if (gameState.phase === "betting" && gameState.currentBettorId === this.playerId) {
      return this.decideBet(gameState, player);
    }

    // Handle player turn
    if (gameState.phase === "player_turn" && gameState.currentTurnId === this.playerId) {
      return this.decidePlay(gameState, player);
    }

    return { action: "stand" };
  }

  private decideBet(gameState: BlackjackGameState, player: BlackjackPlayer): unknown {
    // Calculate bet based on position relative to other players
    const activePlayers = Array.from(gameState.players.values())
      .filter(p => !p.isEliminated);
    
    const myChips = player.chips;
    const avgChips = activePlayers.reduce((sum, p) => sum + p.chips, 0) / activePlayers.length;
    
    // Approaching elimination hand - bet more aggressively if behind
    const isApproachingElimination = gameState.eliminationHands.includes(gameState.handNumber + 1);
    
    let betPercentage = 0.15; // Default 15% of chips
    
    if (isApproachingElimination) {
      if (myChips < avgChips * 0.8) {
        // Behind - bet bigger to catch up
        betPercentage = 0.4;
      } else if (myChips > avgChips * 1.2) {
        // Ahead - bet smaller to protect lead
        betPercentage = 0.1;
      }
    }
    
    const bet = Math.max(
      gameState.minBet,
      Math.min(
        gameState.maxBet,
        Math.floor(myChips * betPercentage)
      )
    );

    return {
      action: "bet",
      amount: bet,
      isSecret: false,
    };
  }

  private decidePlay(gameState: BlackjackGameState, player: BlackjackPlayer): unknown {
    const hand = player.hands[gameState.currentHandIndex];
    if (!hand || hand.isStanding || hand.isBusted) {
      return { action: "stand" };
    }

    const handValue = hand.value;
    const dealerUpcard = this.getDealerUpcard(gameState);
    const canDouble = hand.cards.length === 2 && player.chips >= hand.bet;
    const canSplit = hand.cards.length === 2 && 
      hand.cards[0].rank === hand.cards[1].rank && 
      player.chips >= hand.bet;

    // Check for blackjack (automatic stand)
    if (hand.isBlackjack) {
      return { action: "stand" };
    }

    // Splitting logic (simplified - only split A/8)
    if (canSplit) {
      const pairRank = hand.cards[0].rank;
      if (pairRank === "A" || pairRank === "8") {
        return { action: "split" };
      }
    }

    // Double down logic (on 10 or 11 vs weak dealer)
    if (canDouble && (handValue === 10 || handValue === 11)) {
      if (dealerUpcard >= 2 && dealerUpcard <= 6) {
        return { action: "double" };
      }
      if (handValue === 11) {
        return { action: "double" };
      }
    }

    // Basic strategy
    return { action: this.basicStrategy(handValue, dealerUpcard, hand.cards) };
  }

  private getDealerUpcard(gameState: BlackjackGameState): number {
    for (const card of gameState.dealerHand) {
      if (!card.hidden) {
        return card.value;
      }
    }
    return 10; // Default assumption
  }

  private basicStrategy(handValue: number, dealerUpcard: number, cards: BlackjackCard[]): string {
    const isSoft = cards.some(c => c.rank === "A") && handValue <= 21;
    
    // Hard hands
    if (!isSoft) {
      if (handValue >= 17) return "stand";
      if (handValue <= 11) return "hit";
      
      // 12-16: Stand vs dealer 2-6, hit otherwise
      if (handValue >= 12 && handValue <= 16) {
        if (dealerUpcard >= 2 && dealerUpcard <= 6) {
          return "stand";
        }
        return "hit";
      }
    }
    
    // Soft hands (Ace counted as 11)
    if (isSoft) {
      if (handValue >= 19) return "stand";
      if (handValue <= 17) return "hit";
      // Soft 18: Stand vs 2-8, hit vs 9/10/A
      if (handValue === 18) {
        if (dealerUpcard >= 9 || dealerUpcard === 1) {
          return "hit";
        }
        return "stand";
      }
    }

    return "stand";
  }
}
