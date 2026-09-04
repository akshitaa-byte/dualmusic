"use client";

import React, { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Interface representing a Pairing database record in the history list.
 */
interface PairingRecord {
  id: string;
  trackASource: string;
  trackAId: string | null;
  trackAName: string;
  trackBSource: string;
  trackBId: string | null;
  trackBName: string;
  isFavorite: boolean;
  shareSlug: string;
  playCount: number;
  createdAt: string;
}

/**
 * Listening History & Favorites Page (`/history`).
 *
 * WHAT: Displays all audio track pairings saved or played by the authenticated user.
 * Provides star favorite toggling, shareable link copying, and direct replay capabilities.
 *
 * WHY:
 * 1. User Engagement: Allows users to revisit and replay custom stereo split combinations.
 * 2. Unauthenticated Safety: If the user is not signed in, renders a clean sign-in
 *    prompt instead of throwing a runtime page crash.
 * 3. Aesthetic Consistency: Matches the beige/red flat design system of the main player.
 */
export default function HistoryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [pairings, setPairings] = useState<PairingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  /**
   * Fetches user pairings from `/api/pairings`.
   */
  const fetchPairings = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/pairings");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setPairings(data.pairings || []);
    } catch (err) {
      setErrorMsg(`Failed to load history: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchPairings();
    } else if (status === "unauthenticated") {
      setLoading(false);
    }
  }, [status]);

  /**
   * Toggles the `isFavorite` star status of a target pairing via PATCH request.
   * @param {string} id - Database primary key ID of the pairing.
   * @param {boolean} currentFav - Current favorite state.
   */
  const toggleFavorite = async (id: string, currentFav: boolean) => {
    try {
      const res = await fetch(`/api/pairings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: !currentFav }),
      });
      if (res.ok) {
        setPairings((prev) =>
          prev.map((item) => (item.id === id ? { ...item, isFavorite: !currentFav } : item))
        );
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  /**
   * Copies the public share link URL to the user's clipboard.
   * @param {string} slug - Unique share slug string.
   */
  const copyShareLink = (slug: string) => {
    const url = `${window.location.origin}/share/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2500);
  };

  // Render unauthenticated safety screen — matching beige/red aesthetic
  if (status === "unauthenticated") {
    return (
      <main className="min-h-screen bg-[#f5f0eb] text-[#1c1917] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#eae3db] border border-[#d4c8bc] p-10 text-center space-y-6 shadow-[4px_4px_0px_0px_#1c1917]">
          {/* Lock icon */}
          <div className="w-12 h-12 bg-[#dc2626] border border-[#1c1917] flex items-center justify-center mx-auto shadow-[2px_2px_0px_0px_#1c1917]">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-[#1c1917] uppercase tracking-wider">
              Sign In Required
            </h1>
            <p className="text-sm text-[#78716c]">
              Sign in with Google to view your saved stereo pairings and listening history.
            </p>
          </div>
          <button
            onClick={() => signIn("google")}
            className="w-full py-3 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-sm font-bold uppercase tracking-wider border border-[#1c1917] shadow-[3px_3px_0px_0px_#1c1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#1c1917] transition-all"
          >
            Sign In with Google
          </button>
          <Link
            href="/player"
            className="block text-xs text-[#78716c] hover:text-[#1c1917] uppercase tracking-wider transition-colors"
          >
            ← Return to Player
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f0eb] text-[#1c1917] flex flex-col items-center p-6 space-y-4">

      {/* Top Navigation Bar */}
      <div className="max-w-4xl w-full border border-[#d4c8bc] bg-[#eae3db] p-4 flex items-center justify-between shadow-[2px_2px_0px_0px_#1c1917]">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-bold text-[#dc2626] tracking-widest text-sm uppercase"
            style={{ fontFamily: "var(--font-pixelify), monospace" }}
          >
            DUAL
          </Link>
          <span className="text-[#d4c8bc]">|</span>
          <Link
            href="/player"
            className="text-xs text-[#78716c] hover:text-[#1c1917] uppercase tracking-wider transition-colors"
          >
            ← Back to Player
          </Link>
        </div>
        {session?.user && (
          <div className="flex items-center gap-2 text-xs text-[#78716c]">
            {session.user.image && (
              <img
                src={session.user.image}
                alt={session.user.name || "User"}
                className="w-5 h-5 border border-[#d4c8bc] object-cover"
              />
            )}
            <span className="font-semibold text-[#1c1917]">{session.user.name}</span>
            <span className="w-1.5 h-1.5 bg-[#22c55e] inline-block" title="Logged in" />
          </div>
        )}
      </div>

      {/* Page Title */}
      <div className="max-w-4xl w-full">
        <h1 className="text-2xl font-bold text-[#1c1917] uppercase tracking-widest">
          Pairing History
        </h1>
        <p className="text-xs text-[#78716c] mt-1 uppercase tracking-wider">
          Your saved stereo split listening sessions
        </p>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="max-w-4xl w-full border border-[#dc2626] bg-[#fee2e2] p-4 text-[#dc2626] text-sm font-medium">
          {errorMsg}
        </div>
      )}

      {/* Pairing History List */}
      <div className="max-w-4xl w-full border border-[#d4c8bc] bg-[#eae3db] shadow-[2px_2px_0px_0px_#1c1917]">

        {/* List Header */}
        <div className="border-b border-[#d4c8bc] px-6 py-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[#1c1917]">
            {loading ? "Loading..." : `${pairings.length} pairing${pairings.length !== 1 ? "s" : ""}`}
          </span>
          {pairings.filter((p) => p.isFavorite).length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#dc2626] border border-[#dc2626] px-2 py-0.5">
              {pairings.filter((p) => p.isFavorite).length} Favorited
            </span>
          )}
        </div>

        {loading ? (
          <div className="text-center text-xs text-[#78716c] py-16 uppercase tracking-wider animate-pulse">
            Loading your pairing history...
          </div>
        ) : pairings.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-sm text-[#78716c] uppercase tracking-wider">
              No stereo pairings recorded yet.
            </p>
            <Link
              href="/player"
              className="inline-block text-xs font-bold uppercase tracking-wider border border-[#1c1917] bg-[#f5f0eb] hover:bg-[#d4c8bc] text-[#1c1917] px-6 py-2.5 shadow-[2px_2px_0px_0px_#1c1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#1c1917] transition-all"
            >
              Start Listening
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[#d4c8bc]">
            {pairings.map((item) => (
              <div
                key={item.id}
                className={`px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#f5f0eb] transition-colors ${
                  item.isFavorite ? "border-l-2 border-[#dc2626]" : ""
                }`}
              >
                {/* Track Details */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Left track label */}
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 bg-[#dc2626] inline-block flex-shrink-0" />
                      <span
                        className="font-semibold text-[#dc2626] truncate max-w-[180px]"
                        title={item.trackAName}
                      >
                        {item.trackAName}
                      </span>
                    </span>
                    <span className="text-[#d4c8bc] font-bold">×</span>
                    {/* Right track label */}
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 bg-[#1c1917] inline-block flex-shrink-0" />
                      <span
                        className="font-semibold text-[#1c1917] truncate max-w-[180px]"
                        title={item.trackBName}
                      >
                        {item.trackBName}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-[#78716c] font-mono">
                    <span>Played {item.playCount} time{item.playCount > 1 ? "s" : ""}</span>
                    <span className="text-[#d4c8bc]">•</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    {item.isFavorite && (
                      <>
                        <span className="text-[#d4c8bc]">•</span>
                        <span className="text-[#dc2626] font-bold uppercase tracking-wider text-[10px]">Favorited</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">

                  {/* Star / Favorite Button */}
                  <button
                    onClick={() => toggleFavorite(item.id, item.isFavorite)}
                    title={item.isFavorite ? "Unstar" : "Mark as Favorite"}
                    id={`favorite-btn-${item.id}`}
                    className={`w-8 h-8 flex items-center justify-center text-sm border transition-colors font-bold ${
                      item.isFavorite
                        ? "bg-[#dc2626] border-[#dc2626] text-white"
                        : "border-[#d4c8bc] bg-[#f5f0eb] text-[#78716c] hover:border-[#dc2626] hover:text-[#dc2626]"
                    }`}
                  >
                    ★
                  </button>

                  {/* Share Link Button */}
                  <button
                    onClick={() => copyShareLink(item.shareSlug)}
                    id={`share-btn-${item.id}`}
                    className="px-3 py-1.5 border border-[#d4c8bc] bg-[#f5f0eb] hover:bg-[#d4c8bc] text-[#1c1917] text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    {copiedSlug === item.shareSlug ? "Copied!" : "Share"}
                  </button>

                  {/* Replay Button */}
                  <button
                    onClick={() => router.push(`/player?replay=${item.id}`)}
                    id={`replay-btn-${item.id}`}
                    className="px-4 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-bold uppercase tracking-wider border border-[#1c1917] shadow-[2px_2px_0px_0px_#1c1917] hover:translate-x-[0.5px] hover:translate-y-[0.5px] hover:shadow-[1.5px_1.5px_0px_0px_#1c1917] transition-all"
                  >
                    Replay
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
