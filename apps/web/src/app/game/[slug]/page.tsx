import type { Metadata } from "next";
import SlugResolverClient from "./SlugResolverClient";

const GAME_SERVER_HTTP = (process.env.NEXT_PUBLIC_GAME_SERVER_URL || "http://localhost:3002")
  .replace("ws://", "http://")
  .replace("wss://", "https://");

async function fetchRoomMeta(slug: string) {
  try {
    const res = await fetch(`${GAME_SERVER_HTTP}/api/rooms/slug/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ name: string; roomSlug: string }>;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const data = await fetchRoomMeta(params.slug);

  if (!data) {
    return {
      title: "Room Not Found",
      description: "This room doesn't exist or has expired.",
    };
  }

  const title = `Join ${data.name || data.roomSlug}`;
  return {
    title,
    description: `Join the multiplayer game room — ${data.roomSlug}`,
    openGraph: {
      title,
      description: `Join the multiplayer game room — ${data.roomSlug}`,
    },
    twitter: {
      card: "summary",
      title,
      description: `Join the multiplayer game room — ${data.roomSlug}`,
    },
  };
}

export default function SlugPage({ params }: { params: { slug: string } }) {
  return <SlugResolverClient slug={params.slug} />;
}
