"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { lookupRoomBySlug, type SlugLookupResult } from "@/lib/colyseus";
import { GameStatus } from "@multiplayer/shared";

type State =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "finished" }
  | { kind: "watch_prompt"; roomId: string }
  | { kind: "redirecting" };

export default function SlugResolverClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const result = await lookupRoomBySlug(slug);

      if (cancelled) return;

      if (!result) {
        setState({ kind: "not_found" });
        return;
      }

      const meta = result.metadata as Record<string, unknown> | undefined;
      const status = meta?.status as string | undefined;
      const isFinished = status === GameStatus.FINISHED;
      const isInProgress = status === GameStatus.IN_PROGRESS;

      if (isFinished) {
        setState({ kind: "finished" });
        router.replace(`/lobby?error=finished&slug=${encodeURIComponent(slug)}`);
        return;
      }

      if (isInProgress) {
        // Room is in-progress — offer a Watch button so the user knows they'll
        // be spectating, not joining as a player.
        setState({ kind: "watch_prompt", roomId: result.roomId });
        return;
      }

      // Room is waiting for players — join normally.
      setState({ kind: "redirecting" });
      router.replace(`/game/${result.roomId}`);
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [slug, router]);

  if (state.kind === "not_found") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
        <div className="text-6xl">🔍</div>
        <h1 className="text-2xl font-bold text-white">Room not found</h1>
        <p className="text-surface-400 text-center max-w-sm">
          The room <span className="font-mono text-accent">{slug}</span> doesn&apos;t exist or has
          expired.
        </p>
        <a
          href="/lobby"
          className="px-6 py-2 rounded-xl bg-accent text-white font-medium hover:bg-accent/80 transition-colors"
        >
          Browse open rooms
        </a>
      </div>
    );
  }

  if (state.kind === "watch_prompt") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
        <div className="text-6xl">👁️</div>
        <h1 className="text-2xl font-bold text-white">Game in progress</h1>
        <p className="text-surface-400 text-center max-w-sm">
          Room <span className="font-mono text-accent">{slug}</span> is already underway. You can
          watch as a spectator — you won&apos;t be able to make moves.
        </p>
        <div className="flex gap-3">
          <a
            href="/lobby"
            className="px-6 py-2 rounded-xl bg-surface-700 text-surface-300 font-medium hover:bg-surface-600 transition-colors"
          >
            Back to Lobby
          </a>
          <a
            href={`/game/${state.roomId}`}
            className="px-6 py-2 rounded-xl bg-accent text-white font-medium hover:bg-accent/80 transition-colors"
          >
            Watch Game
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      <p className="text-surface-400">
        {state.kind === "redirecting" ? "Joining room…" : "Looking up room…"}
      </p>
    </div>
  );
}
