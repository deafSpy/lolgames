import { Client } from "@colyseus/core";
import {
  BlackjackState,
  BlackjackPlayerSchema,
  BlackjackCardSchema,
  BlackjackHandSchema,
  ArraySchema,
} from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

interface CardValue {
  min: number;
  max: number;
}

const CARD_VALUES: Record<string, CardValue> = {
  A: { min: 1, max: 11 },
  "2": { min: 2, max: 2 },
  "3": { min: 3, max: 3 },
  "4": { min: 4, max: 4 },
  "5": { min: 5, max: 5 },
  "6": { min: 6, max: 6 },
  "7": { min: 7, max: 7 },
  "8": { min: 8, max: 8 },
  "9": { min: 9, max: 9 },
  "10": { min: 10, max: 10 },
  J: { min: 10, max: 10 },
  Q: { min: 10, max: 10 },
  K: { min: 10, max: 10 },
};

type ActionData =
  | { action: "place_bet"; amount: number; isSecret?: boolean }
  | { action: "hit" }
  | { action: "stand" }
  | { action: "double_down" }
  | { action: "split" }
  | { action: "insurance" }
  | { action: "surrender" }
  | { action: "continue" }; // For next hand/round

export class BlackjackRoom extends BaseRoom<BlackjackState> {
  maxClients = 6; // Tournament supports up to 6 players
  private shoe: BlackjackCardSchema[] = [];
  private playerOrder: string[] = [];

  initializeGame(): void {
    this.setState(new BlackjackState());
    this.state.status = "waiting";
    this.state.phase = "betting";
    this.state.handNumber = 0;
    this.state.deckCount = 6;
    this.state.startingChips = 1000;
    this.state.minBet = 10;
    this.state.maxBet = 500;
    this.state.allowSecretBets = true;

    // Set elimination hands (tournament format)
    this.state.eliminationHands.push(8, 16, 25);

    this.initializeShoe();
  }

  private initializeShoe(): void {
    this.shoe = [];

    for (let d = 0; d < this.state.deckCount; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          const card = new BlackjackCardSchema();
          card.suit = suit;
          card.rank = rank;
          card.faceUp = true;
          this.shoe.push(card);
        }
      }
    }

    this.shuffleShoe();
    this.state.cardsRemaining = this.shoe.length;
  }

  private shuffleShoe(): void {
    for (let i = this.shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
    }
  }

  private drawCard(faceUp: boolean = true): BlackjackCardSchema | null {
    // Reshuffle if less than 20% of shoe remains
    if (this.shoe.length < (this.state.deckCount * 52) * 0.2) {
      this.initializeShoe();
    }

    if (this.shoe.length === 0) return null;

    const card = this.shoe.pop()!;
    card.faceUp = faceUp;
    this.state.cardsRemaining = this.shoe.length;
    return card;
  }

  private calculateHandValue(cards: ArraySchema<BlackjackCardSchema> | BlackjackCardSchema[]): number {
    let value = 0;
    let aces = 0;

    for (const card of cards) {
      if (!card.faceUp) continue; // Don't count face-down cards in visible value

      const cardValue = CARD_VALUES[card.rank];
      if (card.rank === "A") {
        aces++;
        value += 11;
      } else {
        value += cardValue.min;
      }
    }

    // Reduce aces from 11 to 1 if busting
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }

    return value;
  }

  private calculateTrueHandValue(cards: ArraySchema<BlackjackCardSchema> | BlackjackCardSchema[]): number {
    // Calculate value including face-down cards (for server logic)
    let value = 0;
    let aces = 0;

    for (const card of cards) {
      const cardValue = CARD_VALUES[card.rank];
      if (card.rank === "A") {
        aces++;
        value += 11;
      } else {
        value += cardValue.min;
      }
    }

    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }

    return value;
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new BlackjackPlayerSchema();
    player.id = client.sessionId;
    player.displayName = options.playerName || `Guest_${client.sessionId.slice(0, 4)}`;
    player.isReady = false;
    player.isConnected = true;
    player.joinedAt = Date.now();
    player.chips = this.state.startingChips;
    player.isEliminated = false;
    player.hasPlacedBet = false;

    this.state.players.set(client.sessionId, player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, playerName: player.displayName },
      "Player joined Blackjack"
    );

    if (this.clients.length >= this.maxClients) {
      this.lock();
    }
  }

  protected startGame(): void {
    // Set up player order
    this.playerOrder = Array.from(this.state.players.keys());
    this.state.playersRemaining = this.playerOrder.length;

    // First player is button
    this.state.buttonPlayerId = this.playerOrder[0];

    this.state.status = "in_progress";
    this.state.handNumber = 1;
    this.startBettingPhase();

    logger.info({ roomId: this.roomId }, "Blackjack tournament started");
    this.broadcast("game_started", { handNumber: 1 });
  }

  private startBettingPhase(): void {
    this.state.phase = "betting";

    // Reset all hands and bets
    for (const [, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      player.hands.clear();
      player.hasPlacedBet = false;
      player.secretBet = 0;
      player.isSecretBetRevealed = true;
      player.hasInsurance = false;
      player.insuranceBet = 0;
      player.currentHandIndex = 0;
      player.roundWinnings = 0;
    }

    // Clear dealer hand
    this.state.dealerHand.clear();
    this.state.dealerValue = 0;
    this.state.dealerBusted = false;
    this.state.dealerBlackjack = false;

    // Set first bettor (after button position)
    const buttonIndex = this.playerOrder.indexOf(this.state.buttonPlayerId);
    const firstBettorIndex = (buttonIndex + 1) % this.playerOrder.length;
    this.state.currentTurnId = this.getNextActiveBettor(firstBettorIndex);
    this.state.turnStartedAt = Date.now();

    this.broadcast("betting_started", { handNumber: this.state.handNumber });
    this.startTurnTimer();
  }

  private getNextActiveBettor(startIndex: number): string {
    let index = startIndex;
    for (let i = 0; i < this.playerOrder.length; i++) {
      const playerId = this.playerOrder[index];
      const player = this.state.players.get(playerId) as BlackjackPlayerSchema;
      if (player && !player.isEliminated && !player.hasPlacedBet) {
        return playerId;
      }
      index = (index + 1) % this.playerOrder.length;
    }
    return "";
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as ActionData;
    const player = this.state.players.get(client.sessionId) as BlackjackPlayerSchema;

    if (!player) {
      client.send("error", { message: "Player not found" });
      return;
    }

    if (player.isEliminated) {
      client.send("error", { message: "You have been eliminated" });
      return;
    }

    switch (moveData.action) {
      case "place_bet":
        this.handlePlaceBet(client, player, moveData);
        break;
      case "hit":
        this.handleHit(client, player);
        break;
      case "stand":
        this.handleStand(client, player);
        break;
      case "double_down":
        this.handleDoubleDown(client, player);
        break;
      case "split":
        this.handleSplit(client, player);
        break;
      case "insurance":
        this.handleInsurance(client, player);
        break;
      case "surrender":
        this.handlePlayerSurrender(client, player);
        break;
      case "continue":
        // Handled separately for continuation
        break;
      default:
        client.send("error", { message: "Invalid action" });
    }
  }

  private handlePlaceBet(client: Client, player: BlackjackPlayerSchema, data: { amount: number; isSecret?: boolean }): void {
    if (this.state.phase !== "betting") {
      client.send("error", { message: "Not in betting phase" });
      return;
    }

    if (this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn to bet" });
      return;
    }

    if (player.hasPlacedBet) {
      client.send("error", { message: "You have already placed a bet" });
      return;
    }

    // Validate bet amount
    const amount = Math.floor(data.amount);
    if (amount < this.state.minBet) {
      client.send("error", { message: `Minimum bet is ${this.state.minBet}` });
      return;
    }

    if (amount > this.state.maxBet) {
      client.send("error", { message: `Maximum bet is ${this.state.maxBet}` });
      return;
    }

    if (amount > player.chips) {
      client.send("error", { message: "Insufficient chips" });
      return;
    }

    // Create initial hand with bet
    const hand = new BlackjackHandSchema();
    hand.bet = amount;
    player.hands.push(hand);
    player.chips -= amount;
    player.hasPlacedBet = true;

    // Handle secret bet
    if (data.isSecret && this.state.allowSecretBets) {
      player.secretBet = amount;
      player.isSecretBetRevealed = false;
      this.broadcast("bet_placed", {
        playerId: client.sessionId,
        amount: null, // Hidden
        isSecret: true,
      });
    } else {
      this.broadcast("bet_placed", {
        playerId: client.sessionId,
        amount,
        isSecret: false,
      });
    }

    this.moveToNextBettor();
  }

  private moveToNextBettor(): void {
    const currentIndex = this.playerOrder.indexOf(this.state.currentTurnId);
    const nextBettor = this.getNextActiveBettor((currentIndex + 1) % this.playerOrder.length);

    if (nextBettor === "" || this.allBetsPlaced()) {
      // All bets placed, reveal secret bets and start dealing
      this.revealSecretBets();
      this.startDealingPhase();
    } else {
      this.state.currentTurnId = nextBettor;
      this.state.turnStartedAt = Date.now();
      this.startTurnTimer();
    }
  }

  private allBetsPlaced(): boolean {
    for (const [, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      if (!player.isEliminated && !player.hasPlacedBet) {
        return false;
      }
    }
    return true;
  }

  private revealSecretBets(): void {
    for (const [playerId, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      if (player.secretBet > 0) {
        player.isSecretBetRevealed = true;
        this.broadcast("secret_bet_revealed", {
          playerId,
          amount: player.secretBet,
        });
      }
    }
  }

  private startDealingPhase(): void {
    this.state.phase = "dealing";

    // Deal 2 cards to each player
    for (let round = 0; round < 2; round++) {
      for (const playerId of this.playerOrder) {
        const player = this.state.players.get(playerId) as BlackjackPlayerSchema;
        if (player.isEliminated || player.hands.length === 0) continue;

        const card = this.drawCard();
        if (card) {
          player.hands[0].cards.push(card);
        }
      }

      // Deal to dealer (second card face down)
      const dealerCard = this.drawCard(round === 0);
      if (dealerCard) {
        this.state.dealerHand.push(dealerCard);
      }
    }

    // Calculate initial values
    for (const [, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      if (player.hands.length > 0) {
        const hand = player.hands[0];
        hand.value = this.calculateHandValue(hand.cards);
        hand.isBlackjack = hand.cards.length === 2 && hand.value === 21;
      }
    }

    this.state.dealerValue = this.calculateHandValue(this.state.dealerHand);
    this.state.dealerBlackjack = this.calculateTrueHandValue(this.state.dealerHand) === 21;

    this.broadcast("cards_dealt", {});

    // Check for dealer Ace (insurance opportunity)
    if (this.state.dealerHand[0]?.rank === "A") {
      this.state.phase = "player_turn"; // Insurance handled during player turn
      this.broadcast("insurance_available", {});
    }

    // Start player turns
    this.startPlayerTurns();
  }

  private startPlayerTurns(): void {
    this.state.phase = "player_turn";
    this.state.currentTurnId = this.getNextActivePlayer(0);

    if (this.state.currentTurnId) {
      this.state.turnStartedAt = Date.now();
      this.startTurnTimer();
    } else {
      // All players done, dealer's turn
      this.startDealerTurn();
    }
  }

  private getNextActivePlayer(startIndex: number): string {
    let index = startIndex;
    for (let i = 0; i < this.playerOrder.length; i++) {
      const playerId = this.playerOrder[index];
      const player = this.state.players.get(playerId) as BlackjackPlayerSchema;

      if (player && !player.isEliminated && player.hands.length > 0) {
        // Check if player still has actionable hands
        for (let h = 0; h < player.hands.length; h++) {
          const hand = player.hands[h];
          if (!hand.isStanding && !hand.isBusted && !hand.isBlackjack) {
            player.currentHandIndex = h;
            return playerId;
          }
        }
      }
      index = (index + 1) % this.playerOrder.length;
    }
    return "";
  }

  private handleHit(client: Client, player: BlackjackPlayerSchema): void {
    if (this.state.phase !== "player_turn" || this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn" });
      return;
    }

    const hand = player.hands[player.currentHandIndex];
    if (!hand || hand.isStanding || hand.isBusted) {
      client.send("error", { message: "Cannot hit this hand" });
      return;
    }

    const card = this.drawCard();
    if (card) {
      hand.cards.push(card);
      hand.value = this.calculateHandValue(hand.cards);

      if (hand.value > 21) {
        hand.isBusted = true;
        this.broadcast("player_busted", { playerId: client.sessionId, handIndex: player.currentHandIndex });
      }

      this.broadcast("card_hit", {
        playerId: client.sessionId,
        handIndex: player.currentHandIndex,
        card: { suit: card.suit, rank: card.rank },
        value: hand.value,
      });
    }

    this.checkMoveToNextPlayer(player);
  }

  private handleStand(client: Client, player: BlackjackPlayerSchema): void {
    if (this.state.phase !== "player_turn" || this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn" });
      return;
    }

    const hand = player.hands[player.currentHandIndex];
    if (!hand || hand.isStanding || hand.isBusted) {
      client.send("error", { message: "Cannot stand this hand" });
      return;
    }

    hand.isStanding = true;
    this.broadcast("player_stands", { playerId: client.sessionId, handIndex: player.currentHandIndex });

    this.checkMoveToNextPlayer(player);
  }

  private handleDoubleDown(client: Client, player: BlackjackPlayerSchema): void {
    if (this.state.phase !== "player_turn" || this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn" });
      return;
    }

    const hand = player.hands[player.currentHandIndex];
    if (!hand || hand.cards.length !== 2 || hand.isStanding || hand.isBusted) {
      client.send("error", { message: "Cannot double down" });
      return;
    }

    if (player.chips < hand.bet) {
      client.send("error", { message: "Insufficient chips to double down" });
      return;
    }

    // Double the bet
    player.chips -= hand.bet;
    hand.bet *= 2;
    hand.isDoubled = true;

    // Draw exactly one card
    const card = this.drawCard();
    if (card) {
      hand.cards.push(card);
      hand.value = this.calculateHandValue(hand.cards);

      if (hand.value > 21) {
        hand.isBusted = true;
      }
    }

    hand.isStanding = true; // Must stand after double down

    this.broadcast("player_doubled", {
      playerId: client.sessionId,
      handIndex: player.currentHandIndex,
      card: card ? { suit: card.suit, rank: card.rank } : null,
      value: hand.value,
      isBusted: hand.isBusted,
    });

    this.checkMoveToNextPlayer(player);
  }

  private handleSplit(client: Client, player: BlackjackPlayerSchema): void {
    if (this.state.phase !== "player_turn" || this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn" });
      return;
    }

    const hand = player.hands[player.currentHandIndex];
    if (!hand || hand.cards.length !== 2) {
      client.send("error", { message: "Cannot split" });
      return;
    }

    // Check if cards have same rank
    if (hand.cards[0].rank !== hand.cards[1].rank) {
      client.send("error", { message: "Cards must have same rank to split" });
      return;
    }

    if (player.chips < hand.bet) {
      client.send("error", { message: "Insufficient chips to split" });
      return;
    }

    // Create second hand
    const secondCard = hand.cards[1];
    hand.cards.splice(1, 1);

    const newHand = new BlackjackHandSchema();
    newHand.bet = hand.bet;
    newHand.isSplit = true;
    newHand.cards.push(secondCard);
    player.chips -= hand.bet;
    player.hands.push(newHand);

    // Deal one card to each split hand
    const card1 = this.drawCard();
    const card2 = this.drawCard();

    if (card1) hand.cards.push(card1);
    if (card2) newHand.cards.push(card2);

    hand.value = this.calculateHandValue(hand.cards);
    newHand.value = this.calculateHandValue(newHand.cards);
    hand.isSplit = true;

    this.broadcast("player_split", {
      playerId: client.sessionId,
      handIndex: player.currentHandIndex,
    });

    // Continue with current hand
    this.checkMoveToNextPlayer(player);
  }

  private handleInsurance(client: Client, player: BlackjackPlayerSchema): void {
    if (this.state.dealerHand[0]?.rank !== "A") {
      client.send("error", { message: "Insurance not available" });
      return;
    }

    if (player.hasInsurance) {
      client.send("error", { message: "Already took insurance" });
      return;
    }

    const insuranceAmount = Math.floor(player.hands[0]?.bet / 2) || 0;
    if (player.chips < insuranceAmount) {
      client.send("error", { message: "Insufficient chips for insurance" });
      return;
    }

    player.chips -= insuranceAmount;
    player.insuranceBet = insuranceAmount;
    player.hasInsurance = true;

    this.broadcast("insurance_taken", { playerId: client.sessionId, amount: insuranceAmount });
  }

  private handlePlayerSurrender(client: Client, player: BlackjackPlayerSchema): void {
    if (this.state.phase !== "player_turn" || this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn" });
      return;
    }

    const hand = player.hands[player.currentHandIndex];
    if (!hand || hand.cards.length !== 2) {
      client.send("error", { message: "Can only surrender on initial two cards" });
      return;
    }

    // Return half the bet
    const returnAmount = Math.floor(hand.bet / 2);
    player.chips += returnAmount;
    hand.bet = 0;
    hand.isBusted = true; // Mark as lost

    this.broadcast("player_surrendered", { playerId: client.sessionId, returned: returnAmount });

    this.checkMoveToNextPlayer(player);
  }

  private checkMoveToNextPlayer(currentPlayer: BlackjackPlayerSchema): void {
    // Check if current player has more hands to play
    for (let h = currentPlayer.currentHandIndex; h < currentPlayer.hands.length; h++) {
      const hand = currentPlayer.hands[h];
      if (!hand.isStanding && !hand.isBusted && !hand.isBlackjack) {
        currentPlayer.currentHandIndex = h;
        return; // Stay on current player
      }
    }

    // Move to next player
    const currentIndex = this.playerOrder.indexOf(this.state.currentTurnId);
    const nextPlayer = this.getNextActivePlayer((currentIndex + 1) % this.playerOrder.length);

    if (nextPlayer) {
      this.state.currentTurnId = nextPlayer;
      this.state.turnStartedAt = Date.now();
      this.startTurnTimer();
    } else {
      this.startDealerTurn();
    }
  }

  private startDealerTurn(): void {
    this.state.phase = "dealer_turn";
    this.state.currentTurnId = "";

    // Reveal dealer's hole card
    if (this.state.dealerHand.length > 1) {
      this.state.dealerHand[1].faceUp = true;
    }

    this.state.dealerValue = this.calculateTrueHandValue(this.state.dealerHand);

    // Check if all players busted - dealer doesn't need to play
    let allBusted = true;
    for (const [, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      if (player.isEliminated) continue;
      for (const hand of player.hands) {
        if (!hand.isBusted && !hand.isBlackjack) {
          allBusted = false;
          break;
        }
      }
      if (!allBusted) break;
    }

    if (!allBusted) {
      // Dealer hits on 16 or less, stands on 17+
      this.playDealerHand();
    }

    const dealerCards: { suit: string; rank: string }[] = [];
    for (const c of this.state.dealerHand) {
      dealerCards.push({ suit: c.suit, rank: c.rank });
    }
    this.broadcast("dealer_reveals", {
      cards: dealerCards,
      value: this.state.dealerValue,
    });

    this.resolveBets();
  }

  private playDealerHand(): void {
    while (this.state.dealerValue < 17) {
      const card = this.drawCard();
      if (card) {
        this.state.dealerHand.push(card);
        this.state.dealerValue = this.calculateTrueHandValue(this.state.dealerHand);
      } else {
        break;
      }
    }

    if (this.state.dealerValue > 21) {
      this.state.dealerBusted = true;
    }
  }

  private resolveBets(): void {
    this.state.phase = "payout";

    for (const [playerId, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      if (player.isEliminated) continue;

      let totalWinnings = 0;

      for (const hand of player.hands) {
        if (hand.bet === 0) continue; // Surrendered

        let payout = 0;

        if (hand.isBusted) {
          // Lost bet (already deducted)
          payout = 0;
        } else if (hand.isBlackjack) {
          if (this.state.dealerBlackjack) {
            // Push
            payout = hand.bet;
          } else {
            // Blackjack pays 3:2
            payout = Math.floor(hand.bet * 2.5);
          }
        } else if (this.state.dealerBusted) {
          // Dealer busted, player wins
          payout = hand.bet * 2;
        } else if (hand.value > this.state.dealerValue) {
          // Player wins
          payout = hand.bet * 2;
        } else if (hand.value === this.state.dealerValue) {
          // Push
          payout = hand.bet;
        } else {
          // Dealer wins
          payout = 0;
        }

        totalWinnings += payout;
      }

      // Insurance payout
      if (player.hasInsurance && this.state.dealerBlackjack) {
        totalWinnings += player.insuranceBet * 3; // 2:1 payout + original bet
      }

      player.chips += totalWinnings;
      player.roundWinnings = totalWinnings;
    }

    this.broadcast("bets_resolved", {
      dealerValue: this.state.dealerValue,
      dealerBusted: this.state.dealerBusted,
    });

    // Check for elimination
    this.checkElimination();
  }

  private checkElimination(): void {
    const isEliminationHand = this.state.eliminationHands.includes(this.state.handNumber);

    if (isEliminationHand) {
      this.state.phase = "elimination";

      // Find player with lowest chips
      let lowestChips = Infinity;
      let lowestPlayers: string[] = [];

      for (const [playerId, p] of this.state.players) {
        const player = p as BlackjackPlayerSchema;
        if (player.isEliminated) continue;

        if (player.chips < lowestChips) {
          lowestChips = player.chips;
          lowestPlayers = [playerId];
        } else if (player.chips === lowestChips) {
          lowestPlayers.push(playerId);
        }
      }

      // Eliminate player(s) with lowest chips
      for (const playerId of lowestPlayers) {
        const player = this.state.players.get(playerId) as BlackjackPlayerSchema;
        player.isEliminated = true;
        this.state.playersRemaining--;

        this.broadcast("player_eliminated", {
          playerId,
          handNumber: this.state.handNumber,
          chips: player.chips,
        });
      }
    }

    // Check win condition
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
    } else {
      // Start next hand after delay
      this.clock.setTimeout(() => {
        this.startNextHand();
      }, 3000);
    }
  }

  private startNextHand(): void {
    // Rotate button
    const buttonIndex = this.playerOrder.indexOf(this.state.buttonPlayerId);
    let nextButtonIndex = (buttonIndex + 1) % this.playerOrder.length;

    // Skip eliminated players
    while (this.playerOrder.length > 0) {
      const nextPlayer = this.state.players.get(this.playerOrder[nextButtonIndex]) as BlackjackPlayerSchema;
      if (nextPlayer && !nextPlayer.isEliminated) {
        break;
      }
      nextButtonIndex = (nextButtonIndex + 1) % this.playerOrder.length;
      if (nextButtonIndex === buttonIndex) break; // Full circle
    }

    this.state.buttonPlayerId = this.playerOrder[nextButtonIndex];
    this.state.handNumber++;

    this.broadcast("next_hand", { handNumber: this.state.handNumber });

    this.startBettingPhase();
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    const activePlayers: [string, BlackjackPlayerSchema][] = [];
    for (const [id, p] of this.state.players) {
      const player = p as BlackjackPlayerSchema;
      if (!player.isEliminated) {
        activePlayers.push([id, player]);
      }
    }

    if (activePlayers.length === 1) {
      return { winner: activePlayers[0][0], isDraw: false };
    }

    if (activePlayers.length === 0) {
      // All players eliminated (tie on elimination hand)
      return { winner: null, isDraw: true };
    }

    // Check if tournament is complete (after final elimination hand)
    const eliminationHandsArray = Array.from(this.state.eliminationHands) as number[];
    if (eliminationHandsArray.length === 0) return null;
    const maxEliminationHand = Math.max(...eliminationHandsArray);
    if (this.state.handNumber > maxEliminationHand) {
      // Find player with most chips
      let highestChips = 0;
      let winner: string | null = null;

      for (const [playerId, player] of activePlayers) {
        if (player.chips > highestChips) {
          highestChips = player.chips;
          winner = playerId;
        }
      }

      return { winner, isDraw: false };
    }

    return null;
  }
}
