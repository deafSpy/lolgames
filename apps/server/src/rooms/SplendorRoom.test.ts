import { describe, it, expect } from "vitest";

// Splendor game logic tests
type GemType = "white" | "blue" | "green" | "red" | "black";
type GemOrGold = GemType | "gold";

interface SplendorCard {
  id: string;
  gemType: GemType;
  points: number;
  cost: Partial<Record<GemType, number>>;
}

interface SplendorNoble {
  id: string;
  points: number;
  requirements: Partial<Record<GemType, number>>;
}

interface PlayerHand {
  gems: Record<GemOrGold, number>;
  cards: SplendorCard[];
}

function getGemCount(hand: PlayerHand): number {
  return Object.values(hand.gems).reduce((sum, n) => sum + n, 0);
}

function getCardCounts(cards: SplendorCard[]): Record<GemType, number> {
  const counts: Record<GemType, number> = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const card of cards) {
    counts[card.gemType]++;
  }
  return counts;
}

function canAffordCard(hand: PlayerHand, card: SplendorCard): boolean {
  const cardCounts = getCardCounts(hand.cards);
  let goldNeeded = 0;

  for (const [gem, cost] of Object.entries(card.cost)) {
    const discount = cardCounts[gem as GemType] || 0;
    const effectiveCost = Math.max(0, (cost || 0) - discount);
    const playerGems = hand.gems[gem as GemType] || 0;
    
    if (playerGems < effectiveCost) {
      goldNeeded += effectiveCost - playerGems;
    }
  }

  return goldNeeded <= (hand.gems.gold || 0);
}

function qualifiesForNoble(cards: SplendorCard[], noble: SplendorNoble): boolean {
  const cardCounts = getCardCounts(cards);
  
  for (const [gem, required] of Object.entries(noble.requirements)) {
    if ((cardCounts[gem as GemType] || 0) < (required || 0)) {
      return false;
    }
  }
  
  return true;
}

function validateGemTake(
  gemsToTake: Partial<Record<GemType, number>>,
  bank: Record<GemType, number>
): { valid: boolean; reason?: string } {
  const entries = Object.entries(gemsToTake).filter(([, n]) => n && n > 0);
  const totalTaking = entries.reduce((sum, [, n]) => sum + (n || 0), 0);
  const distinctColors = entries.length;

  // Taking 3 different colors (1 each)
  if (distinctColors === 3 && totalTaking === 3) {
    for (const [gem, amount] of entries) {
      if (amount !== 1) return { valid: false, reason: "Must take exactly 1 of each color" };
      if ((bank[gem as GemType] || 0) < 1) return { valid: false, reason: `Not enough ${gem} in bank` };
    }
    return { valid: true };
  }

  // Taking 2 of the same color
  if (distinctColors === 1 && totalTaking === 2) {
    const [gem, amount] = entries[0];
    if (amount !== 2) return { valid: false, reason: "Invalid amount" };
    if ((bank[gem as GemType] || 0) < 4) {
      return { valid: false, reason: `Need at least 4 ${gem} in bank to take 2` };
    }
    return { valid: true };
  }

  // Edge case: taking fewer gems when bank is limited
  if (totalTaking <= 3 && distinctColors <= 3) {
    for (const [gem, amount] of entries) {
      if ((amount || 0) > 1 && (bank[gem as GemType] || 0) < 4) {
        return { valid: false, reason: "Cannot take 2 of a color with less than 4 in bank" };
      }
      if ((bank[gem as GemType] || 0) < (amount || 0)) {
        return { valid: false, reason: `Not enough ${gem} in bank` };
      }
    }
    return { valid: true };
  }

  return { valid: false, reason: "Invalid gem combination" };
}

describe("Splendor Gem Taking", () => {
  const fullBank: Record<GemType, number> = { white: 7, blue: 7, green: 7, red: 7, black: 7 };
  const lowBank: Record<GemType, number> = { white: 2, blue: 3, green: 1, red: 7, black: 7 };

  it("should allow taking 3 different gems", () => {
    const result = validateGemTake({ white: 1, blue: 1, green: 1 }, fullBank);
    expect(result.valid).toBe(true);
  });

  it("should allow taking 2 of the same gem when bank has 4+", () => {
    const result = validateGemTake({ red: 2 }, fullBank);
    expect(result.valid).toBe(true);
  });

  it("should not allow taking 2 of same when bank has less than 4", () => {
    const result = validateGemTake({ white: 2 }, lowBank);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("4");
  });

  it("should not allow taking more than 3 gems", () => {
    const result = validateGemTake({ white: 2, blue: 2 }, fullBank);
    expect(result.valid).toBe(false);
  });

  it("should not allow taking gems not in bank", () => {
    const result = validateGemTake({ green: 2 }, lowBank);
    expect(result.valid).toBe(false);
  });

  it("should allow taking fewer gems when bank is limited", () => {
    const result = validateGemTake({ white: 1, blue: 1 }, lowBank);
    expect(result.valid).toBe(true);
  });
});

describe("Splendor Card Purchasing", () => {
  it("should allow buying card with exact gems", () => {
    const hand: PlayerHand = {
      gems: { white: 2, blue: 1, green: 0, red: 0, black: 0, gold: 0 },
      cards: [],
    };
    const card: SplendorCard = {
      id: "test",
      gemType: "white",
      points: 0,
      cost: { white: 2, blue: 1 },
    };
    expect(canAffordCard(hand, card)).toBe(true);
  });

  it("should allow buying card with gold as wild", () => {
    const hand: PlayerHand = {
      gems: { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 2 },
      cards: [],
    };
    const card: SplendorCard = {
      id: "test",
      gemType: "white",
      points: 0,
      cost: { white: 2, blue: 1 },
    };
    expect(canAffordCard(hand, card)).toBe(true);
  });

  it("should apply card discounts", () => {
    const hand: PlayerHand = {
      gems: { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 },
      cards: [
        { id: "c1", gemType: "white", points: 0, cost: {} },
        { id: "c2", gemType: "white", points: 0, cost: {} },
        { id: "c3", gemType: "blue", points: 0, cost: {} },
      ],
    };
    const card: SplendorCard = {
      id: "test",
      gemType: "green",
      points: 1,
      cost: { white: 2, blue: 1 },
    };
    expect(canAffordCard(hand, card)).toBe(true);
  });

  it("should not allow buying when can't afford", () => {
    const hand: PlayerHand = {
      gems: { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 0 },
      cards: [],
    };
    const card: SplendorCard = {
      id: "test",
      gemType: "white",
      points: 0,
      cost: { white: 3 },
    };
    expect(canAffordCard(hand, card)).toBe(false);
  });
});

describe("Splendor Noble Qualification", () => {
  it("should qualify for noble with exact cards", () => {
    const cards: SplendorCard[] = [
      { id: "c1", gemType: "white", points: 0, cost: {} },
      { id: "c2", gemType: "white", points: 0, cost: {} },
      { id: "c3", gemType: "white", points: 0, cost: {} },
      { id: "c4", gemType: "blue", points: 0, cost: {} },
      { id: "c5", gemType: "blue", points: 0, cost: {} },
      { id: "c6", gemType: "blue", points: 0, cost: {} },
    ];
    const noble: SplendorNoble = {
      id: "n1",
      points: 3,
      requirements: { white: 3, blue: 3 },
    };
    expect(qualifiesForNoble(cards, noble)).toBe(true);
  });

  it("should qualify with more than required cards", () => {
    const cards: SplendorCard[] = [
      { id: "c1", gemType: "white", points: 0, cost: {} },
      { id: "c2", gemType: "white", points: 0, cost: {} },
      { id: "c3", gemType: "white", points: 0, cost: {} },
      { id: "c4", gemType: "white", points: 0, cost: {} },
      { id: "c5", gemType: "blue", points: 0, cost: {} },
      { id: "c6", gemType: "blue", points: 0, cost: {} },
      { id: "c7", gemType: "blue", points: 0, cost: {} },
      { id: "c8", gemType: "blue", points: 0, cost: {} },
    ];
    const noble: SplendorNoble = {
      id: "n1",
      points: 3,
      requirements: { white: 3, blue: 3 },
    };
    expect(qualifiesForNoble(cards, noble)).toBe(true);
  });

  it("should not qualify without enough cards", () => {
    const cards: SplendorCard[] = [
      { id: "c1", gemType: "white", points: 0, cost: {} },
      { id: "c2", gemType: "white", points: 0, cost: {} },
    ];
    const noble: SplendorNoble = {
      id: "n1",
      points: 3,
      requirements: { white: 3, blue: 3 },
    };
    expect(qualifiesForNoble(cards, noble)).toBe(false);
  });
});

describe("Splendor Gem Limit", () => {
  it("should correctly count gems", () => {
    const hand: PlayerHand = {
      gems: { white: 2, blue: 3, green: 1, red: 2, black: 1, gold: 1 },
      cards: [],
    };
    expect(getGemCount(hand)).toBe(10);
  });

  it("should detect over limit", () => {
    const hand: PlayerHand = {
      gems: { white: 3, blue: 3, green: 2, red: 2, black: 1, gold: 1 },
      cards: [],
    };
    expect(getGemCount(hand)).toBeGreaterThan(10);
  });
});
