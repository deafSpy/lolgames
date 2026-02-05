"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { GameCard } from "@/components/ui/GameCard";
import { GameType } from "@multiplayer/shared";

const games = [
  {
    type: GameType.CONNECT4,
    title: "Connect 4",
    description: "Drop discs to connect four in a row. Classic strategy game for 2 players.",
    players: "2 Players",
    duration: "5-10 min",
    gradient: "from-red-500 to-amber-500",
    available: true,
    hasBot: true,
  },
  {
    type: GameType.ROCK_PAPER_SCISSORS,
    title: "Rock Paper Scissors",
    description: "The timeless game of chance and strategy. First to 3 wins.",
    players: "2 Players",
    duration: "1-2 min",
    gradient: "from-violet-500 to-purple-500",
    available: true,
    hasBot: true,
  },
  {
    type: GameType.QUORIDOR,
    title: "Quoridor",
    description: "Strategic maze-building. Block your opponent while racing to the other side.",
    players: "2 Players",
    duration: "15-20 min",
    gradient: "from-emerald-500 to-teal-500",
    available: true,
    hasBot: true,
  },
  {
    type: GameType.SEQUENCE,
    title: "Sequence",
    description: "Cards meet strategy. Create sequences of 5 chips on the board.",
    players: "2-4 Players",
    duration: "20-30 min",
    gradient: "from-blue-500 to-cyan-500",
    available: true,
    hasBot: true,
  },
  {
    type: GameType.SPLENDOR,
    title: "Splendor",
    description: "Collect gems, acquire cards, and attract nobles to build the most prestigious jewelry empire.",
    players: "2-4 Players",
    duration: "30-45 min",
    gradient: "from-pink-500 to-rose-500",
    available: true,
    hasBot: true,
  },
  {
    type: GameType.MONOPOLY_DEAL,
    title: "Monopoly Deal",
    description: "Fast-paced property trading card game. Collect sets and steal from opponents.",
    players: "2-5 Players",
    duration: "15-20 min",
    gradient: "from-green-500 to-emerald-600",
    available: true,
    hasBot: true,
  },
  {
    type: GameType.BLACKJACK,
    title: "Blackjack",
    description: "Beat the dealer by getting closer to 21 without going over. Classic casino game.",
    players: "1-7 Players",
    duration: "5-10 min",
    gradient: "from-slate-700 to-slate-900",
    available: true,
    hasBot: false,
  },
  {
    type: GameType.CATAN,
    title: "Settlers of Catan",
    description: "Trade, build, and settle. Compete to dominate the island through strategy and negotiation.",
    players: "2-4 Players",
    duration: "45-90 min",
    gradient: "from-orange-500 to-yellow-500",
    available: true,
    hasBot: true,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: "easeOut",
    },
  },
};

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-12">
      {/* Hero Section */}
      <motion.section
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16"
      >
        <h1 className="text-5xl md:text-7xl font-display font-bold mb-6">
          <span className="gradient-text">Play Together</span>
          <br />
          <span className="text-surface-100">Anywhere</span>
        </h1>
        <p className="text-xl text-surface-400 max-w-2xl mx-auto mb-8">
          Classic board games reimagined for the modern web. No downloads, no sign-up required.
          Just pure multiplayer fun.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/lobby" className="btn-primary text-lg px-8 py-3">
            Find a Game
          </Link>
          <Link href="/lobby?create=true" className="btn-secondary text-lg px-8 py-3">
            Create Room
          </Link>
        </div>
      </motion.section>

      {/* Games Grid */}
      <motion.section variants={containerVariants} initial="hidden" animate="visible">
        <motion.h2
          variants={itemVariants}
          className="text-2xl font-display font-semibold text-center mb-8"
        >
          Choose Your Game
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {games.map((game) => (
            <motion.div key={game.type} variants={itemVariants}>
              <GameCard {...game} />
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Features Section */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8"
      >
        <FeatureCard
          icon="⚡"
          title="Real-time Multiplayer"
          description="Instant synchronization with WebSocket technology. Every move is reflected immediately."
        />
        <FeatureCard
          icon="🤖"
          title="AI Opponents"
          description="Practice against bots with multiple difficulty levels before challenging real players."
        />
        <FeatureCard
          icon="👤"
          title="No Sign-up Required"
          description="Jump right in as a guest. Create an account later to save your stats and progress."
        />
      </motion.section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="card p-6 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-surface-400 text-sm">{description}</p>
    </div>
  );
}

