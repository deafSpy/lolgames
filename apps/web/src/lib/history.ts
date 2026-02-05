import { GameType } from "@multiplayer/shared";
import { getBrowserSessionId } from "./colyseus";

const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || "ws://localhost:3001";

export interface RemoteHistoryEntry {
  id: string;
  roomId: string;
  gameType: GameType;
  result: "win" | "loss" | "draw" | "aborted";
  opponent: string;
  opponentIds: string[];
  vsBot: boolean;
  endedAt: number;
  durationMs?: number;
}

export async function fetchHistory(token?: string | null): Promise<RemoteHistoryEntry[]> {
  const httpUrl = GAME_SERVER_URL.replace("ws://", "http://").replace("wss://", "https://");
  const params = new URLSearchParams();
  const browserSessionId = getBrowserSessionId();
  if (browserSessionId) {
    params.set("browserSessionId", browserSessionId);
  }

  const response = await fetch(`${httpUrl}/history?${params.toString()}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load history (${response.status})`);
  }

  const body = (await response.json()) as { games: RemoteHistoryEntry[] };
  return body.games || [];
}
