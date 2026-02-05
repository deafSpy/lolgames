"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import type { GameType } from "@multiplayer/shared";

interface GameCardProps {
  type: GameType;
  title: string;
  description: string;
  players: string;
  duration: string;
  gradient: string;
  available: boolean;
  hasBot?: boolean;
}

export function GameCard({
  type,
  title,
  description,
  players,
  duration,
  gradient,
  available,
  hasBot = false,
}: GameCardProps) {
  const CardContent = (
    <motion.div
      whileHover={available ? { scale: 1.02, y: -4 } : {}}
      whileTap={available ? { scale: 0.98 } : {}}
      className={`card-interactive p-6 h-full flex flex-col ${
        !available ? "opacity-60 cursor-not-allowed" : ""
      }`}
    >
      {/* Game Icon/Preview */}
      <div
        className={`h-32 rounded-xl mb-4 bg-gradient-to-br ${gradient} flex items-center justify-center relative overflow-hidden`}
      >
        <div className="absolute inset-0 bg-grid-pattern opacity-20" />
        <GameIcon type={type} />
        {!available && (
          <div className="absolute inset-0 bg-surface-950/60 flex items-center justify-center">
            <span className="text-xs font-medium bg-surface-800 px-3 py-1 rounded-full">
              Coming Soon
            </span>
          </div>
        )}
        {available && hasBot && (
          <div className="absolute top-2 right-2">
            <span className="text-xs px-2 py-1 rounded-full bg-primary-500/90 text-white font-medium">
              🤖 Bot
            </span>
          </div>
        )}
      </div>

      {/* Game Info */}
      <h3 className="font-display font-semibold text-lg mb-2">{title}</h3>
      <p className="text-surface-400 text-sm mb-4 flex-1">{description}</p>

      {/* Meta Info */}
      <div className="flex items-center gap-4 text-xs text-surface-500">
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          {players}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {duration}
        </span>
      </div>
    </motion.div>
  );

  if (!available) {
    return CardContent;
  }

  return (
    <Link href={`/lobby?game=${type}`} className="block h-full">
      {CardContent}
    </Link>
  );
}

function GameIcon({ type }: { type: GameType }) {
  switch (type) {
    case "connect4":
      return (
        <div className="grid grid-cols-4 gap-1">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full ${
                i % 3 === 0
                  ? "bg-white/90"
                  : i % 3 === 1
                    ? "bg-yellow-300/90"
                    : "bg-white/30"
              }`}
            />
          ))}
        </div>
      );
    case "rps":
      return (
        <div className="flex gap-2 text-3xl">
          <span>✊</span>
          <span>✋</span>
          <span>✌️</span>
        </div>
      );
    case "quoridor":
      return (
        <div className="relative">
          <div className="grid grid-cols-3 gap-2">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="w-4 h-4 bg-white/20 rounded-sm" />
            ))}
          </div>
          <div className="absolute top-1/2 left-0 right-0 h-1 bg-white/60 rounded-full" />
        </div>
      );
    case "sequence":
      return (
        <div className="flex gap-1">
          {["♠", "♥", "♦", "♣"].map((suit, i) => (
            <div
              key={i}
              className={`w-8 h-10 rounded bg-white flex items-center justify-center text-lg ${
                suit === "♥" || suit === "♦" ? "text-red-500" : "text-gray-900"
              }`}
            >
              {suit}
            </div>
          ))}
        </div>
      );
    case "catan":
      return (
        <div className="grid grid-cols-3 gap-0.5">
          {["🌲", "🧱", "🌾", "🐑", "⛏️", "🏜️", "🌲", "🌾", "🐑"].map((icon, i) => (
            <div
              key={i}
              className="w-6 h-6 flex items-center justify-center text-sm"
            >
              {icon}
            </div>
          ))}
        </div>
      );
    case "splendor":
      return (
        <div className="flex gap-1">
          {["💎", "💙", "💚", "❤️", "🖤"].map((gem, i) => (
            <div
              key={i}
              className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm"
            >
              {gem}
            </div>
          ))}
        </div>
      );
    case "monopoly_deal":
      return (
        <div className="flex gap-1">
          {["🏠", "💰", "🎲", "⚖️"].map((icon, i) => (
            <div
              key={i}
              className="w-6 h-6 rounded bg-white/20 flex items-center justify-center text-sm"
            >
              {icon}
            </div>
          ))}
        </div>
      );
    case "blackjack":
      return (
        <div className="flex gap-1">
          {["🃏", "♠", "♥", "♣"].map((card, i) => (
            <div
              key={i}
              className={`w-6 h-8 rounded bg-white flex items-center justify-center text-sm ${
                card === "♥" ? "text-red-500" : "text-black"
              }`}
            >
              {card}
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

