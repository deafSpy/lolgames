import { BotAgent, BotConfig } from "./BotAgent.js";

interface SequenceCard {
  rank: string;
  suit: string;
}

interface SequenceChip {
  x: number;
  y: number;
  teamId: number;
  isPartOfSequence: boolean;
}

interface SequencePlayer {
  id: string;
  teamId: number;
  hand: SequenceCard[];
}

interface SequenceGameState {
  currentTurnId: string;
  players: Map<string, SequencePlayer>;
  chips: SequenceChip[];
  team1Sequences: number;
  team2Sequences: number;
}

// Standard Sequence board layout
const BOARD_LAYOUT: string[][] = [
  ["FREE", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "FREE"],
  ["6C", "5C", "4C", "3C", "2C", "AH", "KH", "QH", "10H", "10S"],
  ["7C", "AS", "2D", "3D", "4D", "5D", "6D", "7D", "9H", "QS"],
  ["8C", "KS", "6C", "5C", "4C", "3C", "2C", "8D", "8H", "KS"],
  ["9C", "QS", "7C", "6H", "5H", "4H", "AH", "9D", "7H", "AS"],
  ["10C", "10S", "8C", "7H", "2H", "3H", "KH", "10D", "6H", "2D"],
  ["QC", "9S", "9C", "8H", "9H", "10H", "QH", "QD", "5H", "3D"],
  ["KC", "8S", "10C", "QC", "KC", "AC", "AD", "KD", "4H", "4D"],
  ["AC", "7S", "6S", "5S", "4S", "3S", "2S", "2H", "3H", "5D"],
  ["FREE", "AD", "KD", "QD", "10D", "9D", "8D", "7D", "6D", "FREE"],
];

/**
 * Sequence Bot - uses heuristic strategy
 * Strategy:
 * 1. Play cards that complete or extend sequences
 * 2. Block opponent's near-complete sequences
 * 3. Play cards that are near team's existing chips
 * 4. Use one-eyed jacks to remove opponent's key chips
 * 5. Use two-eyed jacks to fill gaps in sequences
 */
export class SequenceBot extends BotAgent {
  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, {
      ...config,
      thinkingDelay: config.thinkingDelay || 900,
    });
  }

  calculateMove(gameState: SequenceGameState): unknown {
    const player = gameState.players.get(this.playerId);
    if (!player || player.hand.length === 0) {
      return { cardIndex: 0, boardX: 0, boardY: 0 };
    }

    const teamId = player.teamId;
    const opponentTeamId = teamId === 0 ? 1 : 0;

    // Find best move
    const bestMove = this.findBestMove(gameState, player, teamId, opponentTeamId);
    return bestMove;
  }

  private findBestMove(
    gameState: SequenceGameState,
    player: SequencePlayer,
    teamId: number,
    opponentTeamId: number
  ): { cardIndex: number; boardX: number; boardY: number } {
    let bestScore = -Infinity;
    let bestMove = { cardIndex: 0, boardX: 0, boardY: 0 };

    for (let cardIndex = 0; cardIndex < player.hand.length; cardIndex++) {
      const card = player.hand[cardIndex];
      const cardStr = `${card.rank}${this.suitToChar(card.suit)}`;
      
      const isJack = card.rank === "J";
      const isTwoEyedJack = isJack && (card.suit === "diamonds" || card.suit === "clubs");
      const isOneEyedJack = isJack && (card.suit === "hearts" || card.suit === "spades");

      if (isOneEyedJack) {
        // Find opponent chip to remove
        const move = this.findBestRemoval(gameState, cardIndex, opponentTeamId, teamId);
        if (move && move.score > bestScore) {
          bestScore = move.score;
          bestMove = { cardIndex, boardX: move.x, boardY: move.y };
        }
      } else if (isTwoEyedJack) {
        // Find best empty spot
        const move = this.findBestPlacement(gameState, cardIndex, teamId, true);
        if (move && move.score > bestScore) {
          bestScore = move.score;
          bestMove = { cardIndex, boardX: move.x, boardY: move.y };
        }
      } else {
        // Regular card - find matching positions
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 10; x++) {
            if (BOARD_LAYOUT[y][x] === cardStr && !this.isOccupied(gameState, x, y)) {
              const score = this.evaluatePosition(gameState, x, y, teamId);
              if (score > bestScore) {
                bestScore = score;
                bestMove = { cardIndex, boardX: x, boardY: y };
              }
            }
          }
        }
      }
    }

    // If no good move found, play first playable card
    if (bestScore === -Infinity) {
      for (let cardIndex = 0; cardIndex < player.hand.length; cardIndex++) {
        const card = player.hand[cardIndex];
        const cardStr = `${card.rank}${this.suitToChar(card.suit)}`;
        
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 10; x++) {
            if (BOARD_LAYOUT[y][x] === cardStr && !this.isOccupied(gameState, x, y)) {
              return { cardIndex, boardX: x, boardY: y };
            }
          }
        }
      }
    }

    return bestMove;
  }

  private findBestRemoval(
    gameState: SequenceGameState,
    cardIndex: number,
    opponentTeamId: number,
    teamId: number
  ): { x: number; y: number; score: number } | null {
    let best: { x: number; y: number; score: number } | null = null;

    for (const chip of gameState.chips) {
      if (chip.teamId === opponentTeamId && !chip.isPartOfSequence) {
        // Score based on how much this chip helps opponent
        const score = this.evaluatePosition(gameState, chip.x, chip.y, opponentTeamId) + 10;
        if (!best || score > best.score) {
          best = { x: chip.x, y: chip.y, score };
        }
      }
    }

    return best;
  }

  private findBestPlacement(
    gameState: SequenceGameState,
    cardIndex: number,
    teamId: number,
    isWild: boolean
  ): { x: number; y: number; score: number } | null {
    let best: { x: number; y: number; score: number } | null = null;

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (BOARD_LAYOUT[y][x] !== "FREE" && !this.isOccupied(gameState, x, y)) {
          const score = this.evaluatePosition(gameState, x, y, teamId);
          if (!best || score > best.score) {
            best = { x, y, score };
          }
        }
      }
    }

    return best;
  }

  private evaluatePosition(
    gameState: SequenceGameState,
    x: number,
    y: number,
    teamId: number
  ): number {
    let score = 0;

    // Check all 4 directions
    const directions = [
      [1, 0],   // horizontal
      [0, 1],   // vertical
      [1, 1],   // diagonal down-right
      [1, -1],  // diagonal down-left
    ];

    for (const [dx, dy] of directions) {
      const lineScore = this.evaluateLine(gameState, x, y, dx, dy, teamId);
      score += lineScore;
    }

    // Bonus for center positions
    const centerDist = Math.abs(x - 4.5) + Math.abs(y - 4.5);
    score += (9 - centerDist) * 0.5;

    return score;
  }

  private evaluateLine(
    gameState: SequenceGameState,
    x: number,
    y: number,
    dx: number,
    dy: number,
    teamId: number
  ): number {
    // Count team chips and empty spaces in a 5-cell window containing this position
    let maxScore = 0;

    // Check windows that include this position
    for (let start = -4; start <= 0; start++) {
      let teamChips = 0;
      let empty = 0;
      let blocked = false;

      for (let i = 0; i < 5; i++) {
        const nx = x + (start + i) * dx;
        const ny = y + (start + i) * dy;

        if (nx < 0 || nx >= 10 || ny < 0 || ny >= 10) {
          blocked = true;
          break;
        }

        // Free corners count as team chips
        if ((nx === 0 && ny === 0) || (nx === 9 && ny === 0) ||
            (nx === 0 && ny === 9) || (nx === 9 && ny === 9)) {
          teamChips++;
          continue;
        }

        const chip = gameState.chips.find(c => c.x === nx && c.y === ny);
        if (!chip) {
          empty++;
        } else if (chip.teamId === teamId) {
          teamChips++;
        } else {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        // Score based on how close to completing a sequence
        // 4 chips = almost complete = very high value
        // 3 chips = good progress
        // etc.
        const windowScore = teamChips * teamChips; // Exponential scoring
        if (windowScore > maxScore) {
          maxScore = windowScore;
        }
      }
    }

    return maxScore;
  }

  private isOccupied(gameState: SequenceGameState, x: number, y: number): boolean {
    return gameState.chips.some(c => c.x === x && c.y === y);
  }

  private suitToChar(suit: string): string {
    switch (suit) {
      case "hearts": return "H";
      case "diamonds": return "D";
      case "clubs": return "C";
      case "spades": return "S";
      default: return suit.charAt(0).toUpperCase();
    }
  }
}
