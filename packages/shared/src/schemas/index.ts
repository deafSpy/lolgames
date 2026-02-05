import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";

/**
 * Base player schema for all games
 */
export class GamePlayerSchema extends Schema {
  @type("string") id: string = "";
  @type("string") displayName: string = "";
  @type("boolean") isReady: boolean = false;
  @type("boolean") isConnected: boolean = true;
  @type("number") joinedAt: number = 0;
  @type("boolean") isBot: boolean = false;
  @type("boolean") isSpectator: boolean = false;
  @type("boolean") wasInitialPlayer: boolean = false;
}

/**
 * Base game state schema - extend this for each game
 */
export class BaseGameState extends Schema {
  @type("string") status: string = "waiting"; // waiting, in_progress, finished
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 30000; // 30 seconds default
  @type({ map: GamePlayerSchema }) players = new MapSchema<GamePlayerSchema>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
}

/**
 * Connect 4 State Schema
 * Board is a flat array of 42 cells (7 columns x 6 rows)
 * Index = row * 7 + column
 */
export class Connect4State extends BaseGameState {
  @type(["number"]) board = new ArraySchema<number>();
  @type("string") player1Id: string = "";
  @type("string") player2Id: string = "";
  @type("number") moveCount: number = 0;

  constructor() {
    super();
    // Initialize empty board (42 cells)
    for (let i = 0; i < 42; i++) {
      this.board.push(0);
    }
  }
}

/**
 * Rock Paper Scissors State Schema
 */
export class RPSState extends BaseGameState {
  @type("number") roundNumber: number = 1;
  @type("number") targetScore: number = 3; // First to 3 wins
  @type("string") player1Id: string = "";
  @type("string") player2Id: string = "";
  @type("number") player1Score: number = 0;
  @type("number") player2Score: number = 0;
  @type("string") player1Choice: string = ""; // hidden until reveal
  @type("string") player2Choice: string = ""; // hidden until reveal
  @type("boolean") player1Committed: boolean = false;
  @type("boolean") player2Committed: boolean = false;
  @type("string") roundWinnerId: string = "";
  @type("string") phase: string = "commit"; // commit, reveal, result
}

/**
 * Quoridor Player with position and walls
 */
export class QuoridorPlayer extends GamePlayerSchema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") wallsRemaining: number = 10;
  @type("number") goalRow: number = 0; // Row player needs to reach
}

/**
 * Quoridor Wall Schema
 */
export class QuoridorWall extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") orientation: string = "horizontal"; // horizontal or vertical
}

/**
 * Quoridor State Schema
 */
export class QuoridorState extends Schema {
  @type("string") status: string = "waiting";
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 60000; // 60 seconds for strategy game
  @type({ map: QuoridorPlayer }) players = new MapSchema<QuoridorPlayer>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
  @type([QuoridorWall]) walls = new ArraySchema<QuoridorWall>();
  @type("number") boardSize: number = 9;
}

/**
 * Sequence Card Schema
 */
export class SequenceCard extends Schema {
  @type("string") suit: string = "";
  @type("string") rank: string = "";
}

/**
 * Sequence Chip Schema
 */
export class SequenceChip extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") teamId: number = 0;
  @type("boolean") isPartOfSequence: boolean = false;
}

/**
 * Sequence Player Schema
 */
export class SequencePlayer extends GamePlayerSchema {
  @type("number") teamId: number = 0;
  @type([SequenceCard]) hand = new ArraySchema<SequenceCard>();
}

/**
 * Sequence State Schema
 */
export class SequenceState extends Schema {
  @type("string") status: string = "waiting";
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 30000;
  @type({ map: SequencePlayer }) players = new MapSchema<SequencePlayer>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
  @type([SequenceChip]) chips = new ArraySchema<SequenceChip>();
  @type("number") team1Sequences: number = 0;
  @type("number") team2Sequences: number = 0;
  @type("number") sequencesToWin: number = 2;
  @type("number") deckRemaining: number = 104; // 2 decks
}

/**
 * Catan Tile Schema
 */
export class CatanTileSchema extends Schema {
  @type("number") q: number = 0;
  @type("number") r: number = 0;
  @type("string") tileType: string = "desert"; // wood, brick, wheat, sheep, ore, desert
  @type("number") number: number = 0;
  @type("boolean") hasRobber: boolean = false;
}

/**
 * Catan Vertex Schema (settlement/city location)
 */
export class CatanVertexSchema extends Schema {
  @type("string") id: string = "";
  @type("string") building: string = ""; // settlement, city, or empty
  @type("string") playerId: string = "";
}

/**
 * Catan Edge Schema (road location)
 */
export class CatanEdgeSchema extends Schema {
  @type("string") id: string = "";
  @type("boolean") hasRoad: boolean = false;
  @type("string") playerId: string = "";
}

/**
 * Catan Player Schema
 */
export class CatanPlayerSchema extends GamePlayerSchema {
  @type("number") wood: number = 0;
  @type("number") brick: number = 0;
  @type("number") wheat: number = 0;
  @type("number") sheep: number = 0;
  @type("number") ore: number = 0;
  @type("number") points: number = 0;
  @type("number") roadsBuilt: number = 0;
  @type("number") settlementsBuilt: number = 0;
  @type("number") citiesBuilt: number = 0;
  @type("number") longestRoad: number = 0;
  @type("boolean") hasLongestRoad: boolean = false;
}

/**
 * Catan State Schema
 */
export class CatanState extends Schema {
  @type("string") status: string = "waiting";
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 120000; // 2 minutes
  @type({ map: CatanPlayerSchema }) players = new MapSchema<CatanPlayerSchema>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
  @type([CatanTileSchema]) tiles = new ArraySchema<CatanTileSchema>();
  @type({ map: CatanVertexSchema }) vertices = new MapSchema<CatanVertexSchema>();
  @type({ map: CatanEdgeSchema }) edges = new MapSchema<CatanEdgeSchema>();
  @type("string") phase: string = "setup"; // setup, roll, trade, build, robber
  @type("number") lastDiceRoll: number = 0;
  @type("number") setupRound: number = 0; // 1 or 2 during setup
  @type("number") pointsToWin: number = 10;
}

/**
 * Splendor Card Schema
 */
export class SplendorCardSchema extends Schema {
  @type("string") id: string = "";
  @type("number") tier: number = 1;
  @type("string") gemType: string = ""; // white, blue, green, red, black
  @type("number") points: number = 0;
  @type("number") costWhite: number = 0;
  @type("number") costBlue: number = 0;
  @type("number") costGreen: number = 0;
  @type("number") costRed: number = 0;
  @type("number") costBlack: number = 0;
}

/**
 * Splendor Noble Schema
 */
export class SplendorNobleSchema extends Schema {
  @type("string") id: string = "";
  @type("number") points: number = 3;
  @type("number") reqWhite: number = 0;
  @type("number") reqBlue: number = 0;
  @type("number") reqGreen: number = 0;
  @type("number") reqRed: number = 0;
  @type("number") reqBlack: number = 0;
}

/**
 * Splendor Player Schema
 */
export class SplendorPlayerSchema extends GamePlayerSchema {
  @type("number") gemWhite: number = 0;
  @type("number") gemBlue: number = 0;
  @type("number") gemGreen: number = 0;
  @type("number") gemRed: number = 0;
  @type("number") gemBlack: number = 0;
  @type("number") gemGold: number = 0;
  @type([SplendorCardSchema]) cards = new ArraySchema<SplendorCardSchema>();
  @type([SplendorCardSchema]) reserved = new ArraySchema<SplendorCardSchema>();
  @type([SplendorNobleSchema]) nobles = new ArraySchema<SplendorNobleSchema>();
  @type("number") points: number = 0;
}

/**
 * Splendor State Schema
 */
export class SplendorState extends Schema {
  @type("string") status: string = "waiting";
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 60000;
  @type({ map: SplendorPlayerSchema }) players = new MapSchema<SplendorPlayerSchema>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
  // Bank gems
  @type("number") bankWhite: number = 7;
  @type("number") bankBlue: number = 7;
  @type("number") bankGreen: number = 7;
  @type("number") bankRed: number = 7;
  @type("number") bankBlack: number = 7;
  @type("number") bankGold: number = 5;
  // Visible cards on table (4 per tier)
  @type([SplendorCardSchema]) tier1Cards = new ArraySchema<SplendorCardSchema>();
  @type([SplendorCardSchema]) tier2Cards = new ArraySchema<SplendorCardSchema>();
  @type([SplendorCardSchema]) tier3Cards = new ArraySchema<SplendorCardSchema>();
  // Deck sizes (hidden cards)
  @type("number") tier1Remaining: number = 0;
  @type("number") tier2Remaining: number = 0;
  @type("number") tier3Remaining: number = 0;
  // Available nobles
  @type([SplendorNobleSchema]) nobles = new ArraySchema<SplendorNobleSchema>();
  // Phase for discard/noble selection
  @type("string") phase: string = "take_gems"; // take_gems, buy_or_reserve, discard_gems, select_noble
  @type("number") pointsToWin: number = 15;
}

/**
 * Monopoly Deal Card Schema
 */
export class MonopolyDealCardSchema extends Schema {
  @type("string") id: string = "";
  @type("string") cardType: string = ""; // money, property, wildcard, action, rent
  @type("number") value: number = 0;
  @type("string") name: string = "";
  @type("string") actionType: string = ""; // deal_breaker, just_say_no, etc.
  @type("string") color: string = ""; // For properties
  @type(["string"]) colors = new ArraySchema<string>(); // For wildcards
  @type(["number"]) rentValues = new ArraySchema<number>(); // Rent values per set size
}

/**
 * Monopoly Deal Property Set Schema
 */
export class MonopolyDealPropertySetSchema extends Schema {
  @type("string") color: string = "";
  @type([MonopolyDealCardSchema]) cards = new ArraySchema<MonopolyDealCardSchema>();
  @type("boolean") hasHouse: boolean = false;
  @type("boolean") hasHotel: boolean = false;
  @type("boolean") isComplete: boolean = false;
}

/**
 * Monopoly Deal Action Request Schema (for the interrupt stack)
 */
export class MonopolyDealActionRequestSchema extends Schema {
  @type("string") id: string = "";
  @type("string") actionType: string = "";
  @type("string") sourcePlayerId: string = "";
  @type("string") targetPlayerId: string = "";
  @type("string") cardId: string = "";
  @type("number") amount: number = 0;
  @type("string") status: string = "pending"; // pending, resolved, cancelled
  @type("string") payload: string = "{}"; // JSON stringified payload
}

/**
 * Monopoly Deal Player Schema
 */
export class MonopolyDealPlayerSchema extends GamePlayerSchema {
  @type([MonopolyDealCardSchema]) hand = new ArraySchema<MonopolyDealCardSchema>();
  @type([MonopolyDealCardSchema]) bank = new ArraySchema<MonopolyDealCardSchema>(); // Money pile
  @type([MonopolyDealPropertySetSchema]) propertySets = new ArraySchema<MonopolyDealPropertySetSchema>();
  @type("number") completeSets: number = 0;
  @type("number") actionsRemaining: number = 3;
  @type("number") amountOwed: number = 0;
  @type("string") owedToPlayerId: string = "";
}

/**
 * Monopoly Deal State Schema
 */
export class MonopolyDealState extends Schema {
  @type("string") status: string = "waiting";
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 90000; // 90 seconds
  @type({ map: MonopolyDealPlayerSchema }) players = new MapSchema<MonopolyDealPlayerSchema>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
  @type("string") phase: string = "draw"; // draw, play, discard, respond, pay, select_target
  @type("number") deckRemaining: number = 0;
  @type([MonopolyDealCardSchema]) discardPile = new ArraySchema<MonopolyDealCardSchema>();
  @type([MonopolyDealActionRequestSchema]) actionStack = new ArraySchema<MonopolyDealActionRequestSchema>();
  @type("string") activeResponderId: string = ""; // Player who must respond to an action
  @type("number") setsToWin: number = 3;
}

/**
 * Blackjack Card Schema
 */
export class BlackjackCardSchema extends Schema {
  @type("string") suit: string = ""; // hearts, diamonds, clubs, spades
  @type("string") rank: string = ""; // A, 2-10, J, Q, K
  @type("boolean") faceUp: boolean = true;
}

/**
 * Blackjack Hand Schema
 */
export class BlackjackHandSchema extends Schema {
  @type([BlackjackCardSchema]) cards = new ArraySchema<BlackjackCardSchema>();
  @type("number") bet: number = 0;
  @type("boolean") isDoubled: boolean = false;
  @type("boolean") isSplit: boolean = false;
  @type("boolean") isStanding: boolean = false;
  @type("boolean") isBusted: boolean = false;
  @type("boolean") isBlackjack: boolean = false;
  @type("number") value: number = 0; // Computed hand value
}

/**
 * Blackjack Player Schema
 */
export class BlackjackPlayerSchema extends GamePlayerSchema {
  @type([BlackjackHandSchema]) hands = new ArraySchema<BlackjackHandSchema>();
  @type("number") chips: number = 1000;
  @type("number") currentHandIndex: number = 0;
  @type("boolean") hasInsurance: boolean = false;
  @type("number") insuranceBet: number = 0;
  @type("boolean") isEliminated: boolean = false;
  @type("number") secretBet: number = 0;
  @type("boolean") isSecretBetRevealed: boolean = true;
  @type("boolean") hasPlacedBet: boolean = false;
  @type("number") roundWinnings: number = 0;
}

/**
 * Blackjack State Schema (Tournament Mode)
 */
export class BlackjackState extends Schema {
  @type("string") status: string = "waiting";
  @type("string") currentTurnId: string = "";
  @type("number") turnStartedAt: number = 0;
  @type("number") turnTimeLimit: number = 30000;
  @type({ map: BlackjackPlayerSchema }) players = new MapSchema<BlackjackPlayerSchema>();
  @type("string") winnerId: string = "";
  @type("boolean") isDraw: boolean = false;
  @type("string") phase: string = "betting"; // betting, dealing, player_turn, dealer_turn, payout, elimination
  @type([BlackjackCardSchema]) dealerHand = new ArraySchema<BlackjackCardSchema>();
  @type("number") dealerValue: number = 0;
  @type("boolean") dealerBusted: boolean = false;
  @type("boolean") dealerBlackjack: boolean = false;
  @type("number") handNumber: number = 1;
  @type("number") deckCount: number = 6; // Number of decks in shoe
  @type("number") cardsRemaining: number = 0;
  @type("string") buttonPlayerId: string = ""; // Rotating button for betting order
  @type(["number"]) eliminationHands = new ArraySchema<number>(); // e.g., [8, 16, 25]
  @type("number") startingChips: number = 1000;
  @type("number") minBet: number = 10;
  @type("number") maxBet: number = 500;
  @type("boolean") allowSecretBets: boolean = true;
  @type("number") playersRemaining: number = 0;
}

// Re-export Schema for convenience
export { Schema, ArraySchema, MapSchema, type };

