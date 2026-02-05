import { GameType } from "@multiplayer/shared";

export type HistoryResult = "win" | "loss" | "draw" | "aborted";

export interface ParticipantIdentity {
  identity: string;
  displayName: string;
  userId?: string;
  browserSessionId?: string;
  isBot?: boolean;
}

export interface RecordedGameEntry {
  id: string;
  roomId: string;
  gameType: GameType;
  result: HistoryResult;
  opponent: string;
  opponentIds: string[];
  vsBot: boolean;
  endedAt: number;
  durationMs?: number;
}

interface RecordGamePayload {
  roomId: string;
  gameType: GameType;
  winnerId: string | null;
  isDraw: boolean;
  participants: ParticipantIdentity[];
  vsBot?: boolean;
  durationMs?: number;
}

class HistoryService {
  private gamesByIdentity: Map<string, RecordedGameEntry[]> = new Map();

  recordGame(payload: RecordGamePayload): void {
    const { roomId, gameType, winnerId, isDraw, participants, vsBot = false, durationMs } = payload;
    const endedAt = Date.now();

    participants.forEach((participant) => {
      const opponentNames = participants
        .filter((p) => p.identity !== participant.identity)
        .map((p) => p.displayName || "Opponent");
      const opponentIds = participants
        .filter((p) => p.identity !== participant.identity)
        .map((p) => p.identity);

      const result: HistoryResult = isDraw
        ? "draw"
        : winnerId === participant.identity || winnerId === participant.userId
          ? "win"
          : "loss";

      const entry: RecordedGameEntry = {
        id: `${roomId}-${participant.identity}-${endedAt}`,
        roomId,
        gameType,
        result,
        opponent: opponentNames.join(", ") || "Unknown",
        opponentIds,
        vsBot,
        endedAt,
        durationMs,
      };

      const existing = this.gamesByIdentity.get(participant.identity) || [];
      const updated = [entry, ...existing].slice(0, 50); // keep some buffer, later trimmed to 10 on read
      this.gamesByIdentity.set(participant.identity, updated);
    });
  }

  getRecentGames(identity: string, limit = 10): RecordedGameEntry[] {
    const games = this.gamesByIdentity.get(identity) || [];
    return games.slice(0, limit);
  }
}

export const historyService = new HistoryService();
