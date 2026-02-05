"use client";

import React from "react";

/**
 * Shimmer effect CSS for skeleton loaders
 */
const shimmerStyle = `
  @keyframes shimmer {
    0% {
      background-position: -1000px 0;
    }
    100% {
      background-position: 1000px 0;
    }
  }

  .skeleton-shimmer {
    background: linear-gradient(
      90deg,
      #2a2a2a 25%,
      #3a3a3a 50%,
      #2a2a2a 75%
    );
    background-size: 1000px 100%;
    animation: shimmer 2s infinite;
  }
`;

// Add the style to document head
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = shimmerStyle;
  document.head.appendChild(style);
}

/**
 * Skeleton loader for player info section
 */
export function PlayerInfoSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton-shimmer h-12 w-48 rounded-lg" />
      <div className="flex gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="skeleton-shimmer h-10 w-10 rounded-full" />
            <div className="skeleton-shimmer h-4 w-12 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton loader for Connect 4 board
 */
export function Connect4Skeleton() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="skeleton-shimmer h-8 w-40 rounded-lg" />
      <div className="space-y-2">
        {[...Array(6)].map((_, row) => (
          <div key={row} className="flex gap-2">
            {[...Array(7)].map((_, col) => (
              <div
                key={`${row}-${col}`}
                className="skeleton-shimmer h-12 w-12 rounded-full"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton loader for Splendor board
 */
export function SplendorSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton-shimmer h-8 w-40 rounded-lg" />
      
      {/* Nobles section */}
      <div>
        <div className="skeleton-shimmer h-6 w-24 rounded mb-2" />
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton-shimmer h-24 w-20 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Cards and bank section */}
      <div className="flex gap-4">
        <div className="flex-1 space-y-2">
          {[...Array(3)].map((_, tier) => (
            <div key={tier} className="flex gap-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton-shimmer h-32 w-20 rounded-lg" />
              ))}
            </div>
          ))}
        </div>
        <div className="w-24 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton-shimmer h-8 w-full rounded" />
          ))}
        </div>
      </div>

      {/* Player hand section */}
      <div className="skeleton-shimmer h-32 w-full rounded-xl" />
    </div>
  );
}

/**
 * Skeleton loader for Quoridor board
 */
export function QuoridorSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="skeleton-shimmer h-8 w-40 rounded-lg" />
      <div className="skeleton-shimmer h-96 w-96 rounded-lg" />
    </div>
  );
}

/**
 * Skeleton loader for RPS game
 */
export function RPSSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton-shimmer h-8 w-40 rounded-lg" />
      <div className="flex gap-8 justify-center">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton-shimmer h-24 w-24 rounded-lg" />
        ))}
      </div>
      <div className="skeleton-shimmer h-12 w-32 rounded-lg mx-auto" />
    </div>
  );
}

/**
 * Skeleton loader for generic game board
 */
export function GenericGameSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton-shimmer h-8 w-40 rounded-lg" />
      <div className="skeleton-shimmer h-96 w-full rounded-xl" />
      <div className="space-y-2">
        <div className="skeleton-shimmer h-10 w-full rounded-lg" />
        <div className="skeleton-shimmer h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
