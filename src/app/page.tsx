"use client";

import React, { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import {
  decodeAudioFile,
  decodeAudioUrl,
  playStereoSplit,
  stopPlayback,
} from "@/lib/audioEngine";

/**
 * Interface representing track metadata and playback parameters.
 */
interface TrackMetadata {
  name: string;
  source: "jamendo" | "upload";
  id?: string;
}

/**
 * Interface representing track search results from internal API handlers.
 */
interface TrackResult {
  id: string;
  name: string;
  artistName: string;
  albumArt: string;
  audioUrl?: string;
  isPlayable: boolean;
}

/**
 * Phase 4 Main Player Page with Auto-Save Pairing & History Navigation.
 * 
 * WHAT: Enables dual-channel stereo split playback, Jamendo/Spotify music searching, and automatically
 * saves/increments track pairings to database history (`POST /api/pairings`) upon playback initiation.
 * 
 * WHY: Provides seamless listening persistence for authenticated users without blocking active audio playback.
 */
export default function HomePage() {
  const { data: session, status } = useSession();

  // Active track state for Left (A) and Right (B) channels
  const [trackA, setTrackA] = useState<TrackMetadata>({
    name: "No track selected",
    source: "upload",
  });
  const [trackB, setTrackB] = useState<TrackMetadata>({
    name: "No track selected",
    source: "upload",
  });

  const [bufferA, setBufferA] = useState<AudioBuffer | null>(null);
  const [bufferB, setBufferB] = useState<AudioBuffer | null>(null);

  const [loadingLeft, setLoadingLeft] = useState<boolean>(false);
  const [loadingRight, setLoadingRight] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search Controls State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchSource, setSearchSource] = useState<"jamendo" | "spotify">("jamendo");
  const [searchResults, setSearchResults] = useState<TrackResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);

  /**
   * Handles local file selection for the LEFT ear.
   * @param {React.ChangeEvent<HTMLInputElement>} e - File input change event.
   */
  const handleFileAChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setTrackA({
      name: selected.name,
      source: "upload",
    });
    setLoadingLeft(true);
    setErrorMsg(null);
    try {
      const decoded = await decodeAudioFile(selected);
      setBufferA(decoded);
    } catch (err) {
      setErrorMsg(`Failed to decode Left audio file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingLeft(false);
    }
  };

  /**
   * Handles local file selection for the RIGHT ear.
   * @param {React.ChangeEvent<HTMLInputElement>} e - File input change event.
   */
  const handleFileBChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setTrackB({
      name: selected.name,
      source: "upload",
    });
    setLoadingRight(true);
    setErrorMsg(null);
    try {
      const decoded = await decodeAudioFile(selected);
      setBufferB(decoded);
    } catch (err) {
      setErrorMsg(`Failed to decode Right audio file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingRight(false);
    }
  };

  /**
   * Executes music search against Jamendo or Spotify internal API route.
   * @param {React.FormEvent} e - Form submission event.
   */
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchWarning(null);
    setErrorMsg(null);

    try {
      const route = searchSource === "jamendo" ? "/api/search/jamendo" : "/api/search/spotify";
      const res = await fetch(`${route}?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();

      setSearchResults(data.results || []);
      if (data.warning) {
        setSearchWarning(data.warning);
      }
    } catch (err) {
      setErrorMsg(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  /**
   * Assigns a Jamendo search result track to the LEFT ear (Channel 0).
   * @param {TrackResult} track - Jamendo track object containing direct audio URL.
   */
  const assignJamendoTrackToLeft = async (track: TrackResult) => {
    if (!track.audioUrl) return;
    setLoadingLeft(true);
    setErrorMsg(null);
    setTrackA({
      name: `${track.name} - ${track.artistName}`,
      source: "jamendo",
      id: track.id,
    });
    try {
      const decoded = await decodeAudioUrl(track.audioUrl);
      setBufferA(decoded);
    } catch (err) {
      setErrorMsg(`Failed to fetch/decode Jamendo stream: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingLeft(false);
    }
  };

  /**
   * Assigns a Jamendo search result track to the RIGHT ear (Channel 1).
   * @param {TrackResult} track - Jamendo track object containing direct audio URL.
   */
  const assignJamendoTrackToRight = async (track: TrackResult) => {
    if (!track.audioUrl) return;
    setLoadingRight(true);
    setErrorMsg(null);
    setTrackB({
      name: `${track.name} - ${track.artistName}`,
      source: "jamendo",
      id: track.id,
    });
    try {
      const decoded = await decodeAudioUrl(track.audioUrl);
      setBufferB(decoded);
    } catch (err) {
      setErrorMsg(`Failed to fetch/decode Jamendo stream: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingRight(false);
    }
  };

  /**
   * Fire-and-forget background helper to save pairing to history database.
   * 
   * WHAT: Posts track metadata to `/api/pairings` without delaying audio playback.
   * WHY: Non-blocking analytics / history tracking ensures smooth real-time playback.
   */
  const savePairingInBackground = () => {
    if (!session?.user) return;

    fetch("/api/pairings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackASource: trackA.source,
        trackAId: trackA.id || null,
        trackAName: trackA.name,
        trackBSource: trackB.source,
        trackBId: trackB.id || null,
        trackBName: trackB.name,
      }),
    }).catch((err) => {
      console.error("Fire-and-forget pairing save failed:", err);
    });
  };

  /**
   * Starts simultaneous stereo split audio playback.
   */
  const handlePlay = () => {
    if (!bufferA || !bufferB) {
      setErrorMsg("Please select and load both Left and Right audio tracks before playing.");
      return;
    }
    try {
      playStereoSplit(bufferA, bufferB);
      setIsPlaying(true);
      setErrorMsg(null);

      // Record pairing to history asynchronously
      savePairingInBackground();
    } catch (err) {
      setErrorMsg(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * Stops active audio playback.
   */
  const handleStop = () => {
    stopPlayback();
    setIsPlaying(false);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-6 space-y-6">
      {/* User Authentication Header */}
      <div className="max-w-3xl w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
        {status === "loading" ? (
          <div className="text-xs text-slate-400 animate-pulse">Checking authentication status...</div>
        ) : session?.user ? (
          <div className="flex items-center space-x-3">
            {session.user.image ? (
              <img
                src={session.user.image}
                alt={session.user.name || "User Avatar"}
                className="w-10 h-10 rounded-full border border-blue-500/40"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white text-sm">
                {session.user.name?.charAt(0) || "U"}
              </div>
            )}
            <div className="text-xs">
              <div className="font-semibold text-slate-200">{session.user.name}</div>
              <div className="text-slate-400">{session.user.email}</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            Sign in with Google to save custom track pairings &amp; listening history.
          </div>
        )}

        <div className="flex items-center space-x-3">
          {session && (
            <Link
              href="/history"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
            >
              📜 History &amp; Favorites
            </Link>
          )}

          {session ? (
            <button
              onClick={() => signOut()}
              id="auth-button"
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-700 hover:bg-slate-800 text-slate-300 transition-all"
            >
              Sign Out
            </button>
          ) : (
            <button
              onClick={() => signIn("google")}
              id="auth-button"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-all flex items-center space-x-2"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12.24 10.285V13.4h6.887c-.282 1.834-2.133 5.372-6.887 5.372-4.14 0-7.517-3.433-7.517-7.657s3.377-7.657 7.517-7.657c2.355 0 3.928.995 4.827 1.859l2.443-2.354C17.84 1.543 15.28 0 12.24 0 5.48 0 0 5.48 0 12.24s5.48 12.24 12.24 12.24c7.06 0 11.75-4.96 11.75-11.96 0-.8-.08-1.405-.18-2.235H12.24z" />
              </svg>
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Title Banner */}
      <div className="max-w-3xl w-full text-center space-y-2">
        <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
          Stereo Split Music Player
        </h1>
        <p className="text-sm text-slate-400">
          Phase 4: Pairing History, Favorites, &amp; Public Share Links
        </p>
      </div>

      {errorMsg && (
        <div className="max-w-3xl w-full bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Active Track Channels Display & Upload Controls */}
      <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Ear Channel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-3.5 h-3.5 rounded-full bg-blue-500 inline-block animate-pulse" />
              <h2 className="font-bold text-blue-400 text-sm tracking-wider uppercase">
                Left Ear Track
              </h2>
            </div>
            {loadingLeft && <span className="text-xs text-amber-400 animate-pulse">Loading PCM...</span>}
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono truncate">
            {trackA.name}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Upload Custom File:
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileAChange}
              id="left-file-input"
              className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Right Ear Channel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-3.5 h-3.5 rounded-full bg-purple-500 inline-block animate-pulse" />
              <h2 className="font-bold text-purple-400 text-sm tracking-wider uppercase">
                Right Ear Track
              </h2>
            </div>
            {loadingRight && <span className="text-xs text-amber-400 animate-pulse">Loading PCM...</span>}
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono truncate">
            {trackB.name}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Upload Custom File:
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileBChange}
              id="right-file-input"
              className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Global Playback Bar */}
      <div className="max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-center space-x-4 shadow-2xl">
        <button
          onClick={handlePlay}
          disabled={!bufferA || !bufferB}
          id="play-button"
          className="px-8 py-3 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-purple-900/30"
        >
          Play Stereo Split
        </button>
        <button
          onClick={handleStop}
          disabled={!isPlaying}
          id="stop-button"
          className="px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 border border-slate-700 hover:bg-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Stop
        </button>
      </div>

      {isPlaying && (
        <div className="max-w-3xl w-full text-center text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-3 animate-pulse">
          ● Synchronized Playback Active (Left: {trackA.name} | Right: {trackB.name})
        </div>
      )}

      {/* Search Section */}
      <div className="max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h3 className="font-bold text-lg text-slate-100">Find &amp; Load Music Tracks</h3>

          {/* Search Source Toggle Switch */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setSearchSource("jamendo")}
              id="source-jamendo-tab"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                searchSource === "jamendo"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Jamendo (Playable)
            </button>
            <button
              type="button"
              onClick={() => setSearchSource("spotify")}
              id="source-spotify-tab"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                searchSource === "spotify"
                  ? "bg-emerald-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Spotify (Browse Metadata)
            </button>
          </div>
        </div>

        {/* Search Input Form */}
        <form onSubmit={handleSearch} className="flex space-x-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              searchSource === "jamendo"
                ? "Search Jamendo royalty-free tracks (e.g. ambient, rock)..."
                : "Search Spotify track catalog (Metadata search)..."
            }
            id="search-input"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isSearching}
            id="search-button"
            className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-all shadow-md"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchWarning && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-amber-300 text-xs">
            {searchWarning}
          </div>
        )}

        {/* Search Results List */}
        <div className="space-y-3 pt-2">
          {searchResults.length === 0 && !isSearching && (
            <div className="text-center text-xs text-slate-500 py-6">
              Enter a search term above to find tracks.
            </div>
          )}

          {searchResults.map((track) => (
            <div
              key={track.id}
              className="bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between transition-all"
            >
              <div className="flex items-center space-x-3 overflow-hidden">
                <img
                  src={track.albumArt}
                  alt={track.name}
                  className="w-12 h-12 rounded-lg object-cover bg-slate-800 flex-shrink-0"
                />
                <div className="truncate text-xs">
                  <div className="font-semibold text-slate-200 truncate">{track.name}</div>
                  <div className="text-slate-400 truncate">{track.artistName}</div>
                  {!track.isPlayable && (
                    <span className="inline-block mt-1 text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded">
                      Metadata Only (DRM Protected - Not Playable)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                {track.isPlayable ? (
                  <>
                    <button
                      onClick={() => assignJamendoTrackToLeft(track)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 border border-blue-500/30 text-blue-300 hover:text-white text-xs font-medium transition-all"
                    >
                      + Left Ear
                    </button>
                    <button
                      onClick={() => assignJamendoTrackToRight(track)}
                      className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600 border border-purple-500/30 text-purple-300 hover:text-white text-xs font-medium transition-all"
                    >
                      + Right Ear
                    </button>
                  </>
                ) : (
                  <button
                    disabled
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 text-xs font-medium cursor-not-allowed"
                  >
                    Not Playable
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
