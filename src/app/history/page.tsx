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
 * 2. Unauthenticated Safety: If the user is not signed in (`status === "unauthenticated"`),
 *    renders a clean sign-in prompt instead of throwing a runtime page crash.
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

  // Render unauthenticated safety screen
  if (status === "unauthenticated") {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center mx-auto text-xl font-bold">
            🔒
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-100">Authentication Required</h1>
            <p className="text-sm text-slate-400">
              Sign in with your Google account to view your saved stereo pairings and listening history.
            </p>
          </div>
          <button
            onClick={() => signIn("google")}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg transition-all"
          >
            Sign in with Google
          </button>
          <div className="pt-2">
            <Link href="/" className="text-xs text-slate-500 hover:text-slate-300">
              ← Return to Main Player
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-6 space-y-6">
      {/* Header */}
      <div className="max-w-4xl w-full flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-blue-400 hover:underline">
            ← Back to Player
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mt-1">
            Pairing History &amp; Favorites
          </h1>
        </div>
        {session?.user && (
          <div className="text-xs text-slate-400 text-right">
            Logged in as <span className="text-slate-200 font-semibold">{session.user.name}</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="max-w-4xl w-full bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Pairing History List */}
      <div className="max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
        {loading ? (
          <div className="text-center text-xs text-slate-400 py-12 animate-pulse">
            Loading your pairing history...
          </div>
        ) : pairings.length === 0 ? (
          <div className="text-center text-slate-500 py-12 space-y-3">
            <p className="text-sm">No stereo pairings recorded yet.</p>
            <Link
              href="/"
              className="inline-block text-xs text-blue-400 border border-blue-500/30 px-4 py-2 rounded-xl hover:bg-blue-600/10"
            >
              Start Listening Now
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {pairings.map((item) => (
              <div
                key={item.id}
                className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-slate-700"
              >
                {/* Track Details */}
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center space-x-3 text-xs">
                    <span className="font-semibold text-blue-400 truncate max-w-[200px]" title={item.trackAName}>
                      Left: {item.trackAName}
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="font-semibold text-purple-400 truncate max-w-[200px]" title={item.trackBName}>
                      Right: {item.trackBName}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 text-[11px] text-slate-500 font-mono">
                    <span>Played {item.playCount} time{item.playCount > 1 ? "s" : ""}</span>
                    <span>•</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {/* Star Favorite Button */}
                  <button
                    onClick={() => toggleFavorite(item.id, item.isFavorite)}
                    title={item.isFavorite ? "Unstar Favorite" : "Mark as Favorite"}
                    className={`p-2 rounded-xl text-sm border transition-all ${
                      item.isFavorite
                        ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
                        : "border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    ★
                  </button>

                  {/* Shareable Link Button */}
                  <button
                    onClick={() => copyShareLink(item.shareSlug)}
                    className="px-3 py-2 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs transition-all"
                  >
                    {copiedSlug === item.shareSlug ? "✓ Copied!" : "🔗 Share"}
                  </button>

                  {/* Replay Link */}
                  <button
                    onClick={() => router.push(`/?replay=${item.id}`)}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
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
