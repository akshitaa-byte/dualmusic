"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { decodeAudioUrl, playStereoSplit, stopPlayback } from "@/lib/audioEngine";

interface SharedPairing {
  id: string;
  trackASource: string;
  trackAId: string | null;
  trackAName: string;
  trackBSource: string;
  trackBId: string | null;
  trackBName: string;
  shareSlug: string;
  playCount: number;
  createdAt: string;
  user?: {
    name: string | null;
    image: string | null;
  };
}

/**
 * Public Share Page (`/share/[slug]`).
 * 
 * WHAT: Renders a read-only public stereo player for a shared track pairing identified by `shareSlug`.
 * WHY: Allows anyone with the shareable link to listen to custom stereo pairings without needing an account.
 * 
 * @param {object} props - Component props containing React async params.
 */
export default function PublicSharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [pairing, setPairing] = useState<SharedPairing | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [bufferA, setBufferA] = useState<AudioBuffer | null>(null);
  const [bufferB, setBufferB] = useState<AudioBuffer | null>(null);

  const [loadingAudio, setLoadingAudio] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    async function fetchPairing() {
      try {
        const res = await fetch(`/api/pairings/share/${slug}`);
        if (!res.ok) {
          throw new Error("Pairing link not found or expired.");
        }
        const data = await res.json();
        setPairing(data.pairing);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchPairing();
  }, [slug]);

  /**
   * Prepares and starts playback of the shared audio pairing.
   */
  const handlePlayShared = async () => {
    if (!pairing) return;
    setErrorMsg(null);
    setLoadingAudio(true);

    try {
      // Decode audio tracks if not already cached
      let bufA = bufferA;
      let bufB = bufferB;

      if (!bufA) {
        if (pairing.trackASource === "jamendo" && pairing.trackAId) {
          // Fetch Jamendo stream URL
          const jamRes = await fetch(`/api/search/jamendo?q=${encodeURIComponent(pairing.trackAName)}`);
          const jamData = await jamRes.json();
          const match = jamData.results?.[0];
          if (!match || !match.audioUrl) {
            throw new Error(`Could not locate audio stream for Left track: ${pairing.trackAName}`);
          }
          bufA = await decodeAudioUrl(match.audioUrl);
          setBufferA(bufA);
        } else {
          throw new Error("Local uploaded files cannot be streamed over public links without server cloud storage.");
        }
      }

      if (!bufB) {
        if (pairing.trackBSource === "jamendo" && pairing.trackBId) {
          const jamRes = await fetch(`/api/search/jamendo?q=${encodeURIComponent(pairing.trackBName)}`);
          const jamData = await jamRes.json();
          const match = jamData.results?.[0];
          if (!match || !match.audioUrl) {
            throw new Error(`Could not locate audio stream for Right track: ${pairing.trackBName}`);
          }
          bufB = await decodeAudioUrl(match.audioUrl);
          setBufferB(bufB);
        } else {
          throw new Error("Local uploaded files cannot be streamed over public links without server cloud storage.");
        }
      }

      playStereoSplit(bufA, bufB);
      setIsPlaying(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAudio(false);
    }
  };

  /**
   * Stops active playback.
   */
  const handleStopShared = () => {
    stopPlayback();
    setIsPlaying(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-xs text-slate-400 animate-pulse">Loading shared stereo pairing...</div>
      </main>
    );
  }

  if (errorMsg || !pairing) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <div className="text-red-400 font-bold text-lg">Pairing Not Available</div>
          <p className="text-xs text-slate-400">{errorMsg || "The requested link is invalid."}</p>
          <Link href="/" className="inline-block text-xs text-blue-400 hover:underline pt-2">
            ← Go to Stereo Player
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 space-y-6">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <span className="text-[10px] uppercase font-bold tracking-widest text-purple-400 bg-purple-950/60 border border-purple-800/40 px-3 py-1 rounded-full">
            Public Shared Pairing
          </span>
          <h1 className="text-2xl font-extrabold text-slate-100 mt-2">
            Stereo Split Experience
          </h1>
          {pairing.user?.name && (
            <p className="text-xs text-slate-400">Shared by {pairing.user.name}</p>
          )}
        </div>

        {/* Channels Display */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="text-[10px] uppercase font-bold text-blue-400">Left Ear Track</span>
            <div className="text-xs font-semibold text-slate-200 truncate">{pairing.trackAName}</div>
            <div className="text-[10px] text-slate-500 capitalize">Source: {pairing.trackASource}</div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="text-[10px] uppercase font-bold text-purple-400">Right Ear Track</span>
            <div className="text-xs font-semibold text-slate-200 truncate">{pairing.trackBName}</div>
            <div className="text-[10px] text-slate-500 capitalize">Source: {pairing.trackBSource}</div>
          </div>
        </div>

        {/* Play Controls */}
        <div className="flex items-center justify-center space-x-4 pt-2">
          <button
            onClick={handlePlayShared}
            disabled={loadingAudio}
            className="px-8 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg transition-all disabled:opacity-50"
          >
            {loadingAudio ? "Fetching Stream..." : "Play Shared Split"}
          </button>
          <button
            onClick={handleStopShared}
            disabled={!isPlaying}
            className="px-6 py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm font-semibold disabled:opacity-40"
          >
            Stop
          </button>
        </div>

        {isPlaying && (
          <div className="text-center text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-3 animate-pulse">
            ● Shared Playback Active
          </div>
        )}

        <div className="text-center pt-2">
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-300">
            Create your own stereo split →
          </Link>
        </div>
      </div>
    </main>
  );
}
