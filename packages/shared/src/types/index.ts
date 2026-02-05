// Game Types
export enum GameType {
  CONNECT4 = "connect4",
  SEQUENCE = "sequence",
  QUORIDOR = "quoridor",
  ROCK_PAPER_SCISSORS = "rps",
  CATAN = "catan",
  SPLENDOR = "splendor",
  MONOPOLY_DEAL = "monopoly_deal",
  BLACKJACK = "blackjack",
}

export enum GameStatus {
  WAITING = "waiting",
  IN_PROGRESS = "in_progress",
  FINISHED = "finished",
  CANCELLED = "cancelled",
}

export enum PlayerStatus {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  SPECTATING = "spectating",
}

// Player Types
export interface GuestPlayer {
  id: string;
  displayName: string;
  isGuest: true;
  avatarSeed?: string;
}

export interface RegisteredPlayer {
  id: string;
  displayName: string;
  isGuest: false;
  email: string;
  avatarUrl?: string;
}

export type Player = GuestPlayer | RegisteredPlayer;

// Lobby Types
export interface LobbyRoom {
  roomId: string;
  gameType: GameType;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: GameStatus;
  createdAt: number;
}

// Game Result Types
export interface GameResult {
  winnerId: string | null; // null for draw
  isDraw: boolean;
  scores: Record<string, number>;
  duration: number; // in seconds
  moves: number;
}

// Messages
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

// Connect 4 specific types
export enum Connect4Cell {
  EMPTY = 0,
  PLAYER_1 = 1,
  PLAYER_2 = 2,
}

export interface Connect4Move {
  column: number;
  playerId: string;
}

// Rock Paper Scissors specific types
export enum RPSChoice {
  ROCK = "rock",
  PAPER = "paper",
  SCISSORS = "scissors",
}

export interface RPSRound {
  roundNumber: number;
  player1Choice: RPSChoice | null;
  player2Choice: RPSChoice | null;
  winnerId: string | null;
}

// Quoridor specific types
export interface QuoridorPosition {
  x: number;
  y: number;
}

export interface QuoridorWallPlacement {
  x: number;
  y: number;
  orientation: "horizontal" | "vertical";
}

// Sequence specific types
export interface SequenceCardInfo {
  suit: "hearts" | "diamonds" | "clubs" | "spades";
  rank: string; // 2-10, J, Q, K, A
}

export interface SequenceChipPlacement {
  x: number;
  y: number;
  teamId: number;
}

// Catan specific types
export enum CatanResource {
  WOOD = "wood",
  BRICK = "brick",
  WHEAT = "wheat",
  SHEEP = "sheep",
  ORE = "ore",
}

export enum CatanTileType {
  WOOD = "wood",
  BRICK = "brick",
  WHEAT = "wheat",
  SHEEP = "sheep",
  ORE = "ore",
  DESERT = "desert",
}

export enum CatanPhase {
  SETUP = "setup",
  ROLL = "roll",
  TRADE = "trade",
  BUILD = "build",
  ROBBER = "robber",
}

export interface CatanHexCoord {
  q: number;
  r: number;
}

export interface CatanVertex {
  id: string; // e.g., "0,0,N" or "0,0,S"
  building: "settlement" | "city" | null;
  playerId: string | null;
}

export interface CatanEdge {
  id: string; // e.g., "0,0,NE"
  hasRoad: boolean;
  playerId: string | null;
}

export interface CatanTile {
  q: number;
  r: number;
  type: CatanTileType;
  number: number; // 2-12, 0 for desert
  hasRobber: boolean;
}

export interface CatanTradeOffer {
  offerId: string;
  fromPlayerId: string;
  offer: Record<CatanResource, number>;
  request: Record<CatanResource, number>;
  targetPlayerId: string | null; // null = open to all
  status: "pending" | "accepted" | "rejected" | "cancelled";
}

// Splendor specific types
export enum SplendorGemType {
  WHITE = "white", // Diamond
  BLUE = "blue", // Sapphire
  GREEN = "green", // Emerald
  RED = "red", // Ruby
  BLACK = "black", // Onyx
  GOLD = "gold", // Wild/Joker
}

export interface SplendorCard {
  id: string;
  tier: 1 | 2 | 3;
  gemType: SplendorGemType; // The gem discount this card provides
  points: number;
  cost: Partial<Record<SplendorGemType, number>>;
}

export interface SplendorNoble {
  id: string;
  points: number;
  requirements: Partial<Record<SplendorGemType, number>>; // Card counts needed
}

export interface SplendorPlayerHand {
  gems: Record<SplendorGemType, number>;
  cards: SplendorCard[];
  reserved: SplendorCard[];
  nobles: SplendorNoble[];
}

export enum SplendorPhase {
  TAKE_GEMS = "take_gems",
  BUY_OR_RESERVE = "buy_or_reserve",
  DISCARD_GEMS = "discard_gems",
  SELECT_NOBLE = "select_noble",
}

// Monopoly Deal specific types
export enum MonopolyDealCardType {
  MONEY = "money",
  PROPERTY = "property",
  WILDCARD = "wildcard",
  ACTION = "action",
  RENT = "rent",
}

export enum MonopolyDealActionType {
  DEAL_BREAKER = "deal_breaker",
  JUST_SAY_NO = "just_say_no",
  SLY_DEAL = "sly_deal",
  FORCED_DEAL = "forced_deal",
  DEBT_COLLECTOR = "debt_collector",
  ITS_MY_BIRTHDAY = "its_my_birthday",
  PASS_GO = "pass_go",
  HOUSE = "house",
  HOTEL = "hotel",
  DOUBLE_THE_RENT = "double_the_rent",
}

export enum MonopolyDealPropertyColor {
  BROWN = "brown",
  LIGHT_BLUE = "light_blue",
  PINK = "pink",
  ORANGE = "orange",
  RED = "red",
  YELLOW = "yellow",
  GREEN = "green",
  DARK_BLUE = "dark_blue",
  RAILROAD = "railroad",
  UTILITY = "utility",
}

export enum MonopolyDealPhase {
  DRAW = "draw",
  PLAY = "play",
  DISCARD = "discard",
  RESPOND = "respond", // For Just Say No and payment responses
  PAY = "pay", // When player owes money/property
  SELECT_TARGET = "select_target", // When player needs to select a target for action
}

export interface MonopolyDealCard {
  id: string;
  type: MonopolyDealCardType;
  value: number; // Money value (for paying rent or playing as money)
  name: string;
  actionType?: MonopolyDealActionType;
  color?: MonopolyDealPropertyColor;
  colors?: MonopolyDealPropertyColor[]; // For wildcard properties
  rentValues?: number[]; // Rent values for 1, 2, ... properties
}

export interface MonopolyDealPropertySet {
  color: MonopolyDealPropertyColor;
  cards: MonopolyDealCard[];
  hasHouse: boolean;
  hasHotel: boolean;
}

export interface MonopolyDealActionRequest {
  id: string;
  type: MonopolyDealActionType;
  sourcePlayerId: string;
  targetPlayerId: string;
  cardId: string;
  amount?: number; // For rent/debt
  payload?: Record<string, unknown>;
  status: "pending" | "resolved" | "cancelled";
}

// Blackjack Tournament specific types
export enum BlackjackPhase {
  BETTING = "betting",
  DEALING = "dealing",
  PLAYER_TURN = "player_turn",
  DEALER_TURN = "dealer_turn",
  PAYOUT = "payout",
  ELIMINATION = "elimination",
}

export enum BlackjackAction {
  HIT = "hit",
  STAND = "stand",
  DOUBLE_DOWN = "double_down",
  SPLIT = "split",
  INSURANCE = "insurance",
  SURRENDER = "surrender",
}

export interface BlackjackCard {
  suit: "hearts" | "diamonds" | "clubs" | "spades";
  rank: string; // A, 2-10, J, Q, K
  faceUp: boolean;
}

export interface BlackjackHand {
  cards: BlackjackCard[];
  bet: number;
  isDoubled: boolean;
  isSplit: boolean;
  isStanding: boolean;
  isBusted: boolean;
  isBlackjack: boolean;
}

export interface BlackjackPlayerState {
  hands: BlackjackHand[];
  chips: number;
  currentHandIndex: number;
  hasInsurance: boolean;
  insuranceBet: number;
  isEliminated: boolean;
  secretBet: number | null; // For tournament secret betting
  isSecretBetRevealed: boolean;
}

export interface BlackjackTournamentConfig {
  startingChips: number;
  minBet: number;
  maxBet: number;
  eliminationHands: number[]; // e.g., [8, 16, 25]
  handsPerRound: number;
  allowSecretBets: boolean;
}

