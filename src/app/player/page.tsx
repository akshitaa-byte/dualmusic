"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import {
  decodeAudioFile,
  decodeAudioUrl,
  playStereoSplit,
  playStereoSplitIndependent,
  pausePlayback,
  resumePlayback,
  restartPlayback,
  stopPlayback,
  setLeftVolume,
  setRightVolume,
  getAudioContext,
  getPlaybackInfo,
} from "@/lib/audioEngine";

/**
 * Interface representing track metadata and playback parameters.
 * audioUrl is present for Jamendo tracks (CORS-accessible stream URLs) and absent for uploads.
 * WHY: The WebSocket sync_state handler needs audioUrl to fetch and decode a track on a
 * joining client, and assignJamendoTrackToLeft/Right store it so mid-room track changes
 * can propagate the stream URL to all room members.
 */
interface TrackMetadata {
  name: string;
  source: "jamendo" | "upload";
  id?: string;
  audioUrl?: string;
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
 * Feature flag evaluated once at module load time.
 * WHAT: Reads NEXT_PUBLIC_SYNC_ROOMS_ENABLED from the environment.
 * WHY: Using a module-level constant (not inline JSX) ensures Next.js statically replaces
 * the value at build time, so the room section is tree-shaken away on production builds
 * where the variable is absent. Comparing strictly to the string "true" avoids implicit
 * boolean coercions from empty strings or undefined.
 */
const SYNC_ROOMS_ENABLED =
  process.env.NEXT_PUBLIC_SYNC_ROOMS_ENABLED === "true";

/**
 * Phase 5 Main Player Page with Real-Time Synchronized Listening Rooms & NTP Clock Alignment.
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
  
  // Playback state tracking: "stopped" | "playing" | "paused"
  const [playbackState, setPlaybackState] = useState<"stopped" | "playing" | "paused">("stopped");
  
  // Volume state (0 to 100)
  const [leftVol, setLeftVol] = useState<number>(100);
  const [rightVol, setRightVol] = useState<number>(100);

  // Active pairing & favoriting state
  const [activePairingId, setActivePairingId] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Seek / Scrub State ---
  // Current playhead positions in seconds for each channel (independently seekable)
  const [seekA, setSeekA] = useState<number>(0);
  const [seekB, setSeekB] = useState<number>(0);
  // Ref flags: true while the user is actively dragging a scrub slider
  const isScrubbingA = useRef(false);
  const isScrubbingB = useRef(false);
  // rAF handle for the animation loop
  const rafRef = useRef<number | null>(null);

  // Search Controls State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchSource, setSearchSource] = useState<"jamendo" | "spotify">("jamendo");
  const [searchResults, setSearchResults] = useState<TrackResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [isGenreDropdownOpen, setIsGenreDropdownOpen] = useState<boolean>(false);

  /**
   * Formats a number of seconds into a mm:ss string for the scrub bar timestamp display.
   * @param {number} s - Total seconds (may be fractional).
   * @returns {string} Formatted time string e.g. "3:07".
   */
  const fmt = (s: number): string => {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  /**
   * requestAnimationFrame loop that updates seekA / seekB while audio is playing.
   * WHY: AudioBufferSourceNode has no live currentTime property. We derive position
   * from audioContext.currentTime using getPlaybackInfo() from the engine module.
   */
  const startRafLoop = useCallback(() => {
    const tick = () => {
      const info = getPlaybackInfo();
      if (!isScrubbingA.current) {
        setSeekA(info.elapsedA);
      }
      if (!isScrubbingB.current) {
        setSeekB(info.elapsedB);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRafLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Start/stop the rAF loop based on playback state
  useEffect(() => {
    if (playbackState === "playing") {
      startRafLoop();
    } else {
      stopRafLoop();
    }
    return stopRafLoop;
  }, [playbackState, startRafLoop, stopRafLoop]);

  /**
   * Handles Left channel scrub slider release: seeks bufferA to the new position.
   * If playback is active, restarts both channels with independent offsets.
   */
  const handleSeekA = async (newSec: number) => {
    isScrubbingA.current = false;
    setSeekA(newSec);
    if (bufferA && bufferB && playbackState !== "stopped") {
      if (audioContextInstance_unused_ref && getAudioContext().state === "suspended") {
        await getAudioContext().resume();
      }
      playStereoSplitIndependent(bufferA, bufferB, newSec, seekB);
      setPlaybackState("playing");
    } else if (bufferA && bufferB && playbackState === "stopped") {
      // Just update the stored position; will use it on next Play
      setSeekA(newSec);
    }
  };

  /**
   * Handles Right channel scrub slider release: seeks bufferB to the new position.
   */
  const handleSeekB = async (newSec: number) => {
    isScrubbingB.current = false;
    setSeekB(newSec);
    if (bufferA && bufferB && playbackState !== "stopped") {
      if (getAudioContext().state === "suspended") {
        await getAudioContext().resume();
      }
      playStereoSplitIndependent(bufferA, bufferB, seekA, newSec);
      setPlaybackState("playing");
    }
  };

  // Unused ref placeholder to satisfy lint — getAudioContext is used inside handlers
  const audioContextInstance_unused_ref = null;

  // AI Vibe Suggestion State
  const [vibeInput, setVibeInput] = useState<string>("");
  const [isVibeLoading, setIsVibeLoading] = useState<boolean>(false);
  const [vibeError, setVibeError] = useState<string | null>(null);
  const [vibeReasoning, setVibeReasoning] = useState<string | null>(null);
  const [vibeQueryA, setVibeQueryA] = useState<string | null>(null);
  const [vibeQueryB, setVibeQueryB] = useState<string | null>(null);
  const [vibeResultsA, setVibeResultsA] = useState<TrackResult[]>([]);
  const [vibeResultsB, setVibeResultsB] = useState<TrackResult[]>([]);
  const [vibeNamedSongs, setVibeNamedSongs] = useState<Array<{ title: string; artist: string; albumArt: string }>>([]);
  const [vibeBpmWarning, setVibeBpmWarning] = useState<string | null>(null);
  const [vibeBestPair, setVibeBestPair] = useState<{ trackA: TrackResult; trackB: TrackResult; diff: number } | null>(null);

  const genreDropdownRef = React.useRef<HTMLFormElement>(null);

  /**
   * Submits user vibe input to /api/ai/vibe-suggest and updates recommendation state.
   */
  const handleVibeSuggest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vibeInput.trim()) {
      setVibeError("Please describe a vibe first");
      return;
    }

    setIsVibeLoading(true);
    setVibeError(null);
    setVibeReasoning(null);
    setVibeQueryA(null);
    setVibeQueryB(null);
    setVibeResultsA([]);
    setVibeResultsB([]);
    setVibeNamedSongs([]);
    setVibeBpmWarning(null);
    setVibeBestPair(null);

    try {
      const res = await fetch("/api/ai/vibe-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vibe: vibeInput }),
      });

      const data = await res.json();

      if (!res.ok) {
        setVibeError(data.error || "Failed to generate vibe suggestion.");
        return;
      }

      setVibeReasoning(data.reasoning);
      setVibeQueryA(data.searchQueryA);
      setVibeQueryB(data.searchQueryB);
      setVibeResultsA(data.resultsA || []);
      setVibeResultsB(data.resultsB || []);
      setVibeNamedSongs(data.namedSongSuggestions || []);
      setVibeBpmWarning(data.bpmWarning || null);
      setVibeBestPair(data.bestPair || null);
    } catch {
      setVibeError("Network error. Could not connect to AI suggestion service.");
    } finally {
      setIsVibeLoading(false);
    }
  };

  // List of Jamendo genres and tags for the dropdown
  const JAMENDO_GENRES = [
    "Ambient",
    "Pop",
    "Rock",
    "Electronic",
    "Hip-Hop",
    "Jazz",
    "Classical",
    "Indie",
    "Acoustic",
    "Chillout",
    "Dance",
    "Deep House",
    "Disco",
    "Folk",
    "Funk",
    "Heavy Metal",
    "House",
    "Instrumental",
    "Lo-Fi",
    "Lounge",
    "Metal",
    "Piano",
    "Punk",
    "Reggae",
    "R&B",
    "Soul",
    "Synthwave",
    "Techno",
    "Trance",
    "World",
  ];

  // Close dropdown on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (genreDropdownRef.current && !genreDropdownRef.current.contains(event.target as Node)) {
        setIsGenreDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredGenres = JAMENDO_GENRES.filter((genre) =>
    genre.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const triggerSearchForQuery = async (queryText: string) => {
    setIsSearching(true);
    setSearchWarning(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/search/jamendo?q=${encodeURIComponent(queryText)}`);
      if (!res.ok) {
        setErrorMsg("Search service is temporarily unavailable.");
        setSearchResults([]);
        return;
      }
      const data = await res.json();
      setSearchResults(data.results || []);
      if (data.warning) setSearchWarning(data.warning);
    } catch {
      setErrorMsg("Search service is temporarily unavailable.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Phase 5: Real-time Listening Room & Clock Sync State
  const [roomCodeInput, setRoomCodeInput] = useState<string>("");
  const [roomPasswordInput, setRoomPasswordInput] = useState<string>("");
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [wsClient, setWsClient] = useState<WebSocket | null>(null);
  const [roomMemberCount, setRoomMemberCount] = useState<number>(1);
  
  // NTP Clock Offset (in milliseconds)
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);
  const [avgLatencyMs, setAvgLatencyMs] = useState<number>(0);
  const [isSyncingClock, setIsSyncingClock] = useState<boolean>(false);

  /**
   * Ref to hold target execution data when waiting for remote room start
   */
  const bufferARef = React.useRef(bufferA);
  const bufferBRef = React.useRef(bufferB);
  bufferARef.current = bufferA;
  bufferBRef.current = bufferB;

  /**
   * Executes NTP High-Precision Clock Synchronization with WebSocket Server.
   * 
   * WHAT: Sends 10 sequential ping requests measuring Round-Trip Time (RTT) and calculating clock offset.
   * WHY: Mitigates network jitter to allow sample-accurate synchronized Web Audio execution.
   */
  const performNTPClockSync = (ws: WebSocket) => {
    setIsSyncingClock(true);
    const pings: Array<{ rtt: number; offset: number }> = [];
    let pingCount = 0;
    const TOTAL_PINGS = 8;

    const sendPing = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const clientSendTime = Date.now();
      ws.send(JSON.stringify({ type: "ping", clientTime: clientSendTime }));
    };

    const handlePongMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "pong") {
          const clientReceiveTime = Date.now();
          const clientSendTime = data.clientTime;
          const serverTime = data.serverTime;

          const rtt = clientReceiveTime - clientSendTime;
          // Standard NTP offset formula: ((server - send) + (server - receive)) / 2
          const offset = ((serverTime - clientSendTime) + (serverTime - clientReceiveTime)) / 2;

          pings.push({ rtt, offset });
          pingCount++;

          if (pingCount < TOTAL_PINGS) {
            setTimeout(sendPing, 80);
          } else {
            // Calculate averages
            const avgOffset = pings.reduce((sum, p) => sum + p.offset, 0) / pings.length;
            const avgRtt = pings.reduce((sum, p) => sum + p.rtt, 0) / pings.length;

            setClockOffsetMs(Math.round(avgOffset));
            setAvgLatencyMs(Math.round(avgRtt / 2));
            setIsSyncingClock(false);

            console.log(
              `[NTP Clock Sync Complete] Clock Offset: ${avgOffset.toFixed(2)}ms | One-way Latency: ${(avgRtt / 2).toFixed(2)}ms`
            );
            ws.removeEventListener("message", handlePongMessage);
          }
        }
      } catch (err) {
        console.error("NTP Clock Sync parsing error:", err);
      }
    };

    ws.addEventListener("message", handlePongMessage);
    sendPing();
  };

  /**
   * Connects to standalone WebSocket room server and joins target room code.
   */
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    /**
     * Guard: do not attempt any WebSocket connection when the rooms feature is disabled.
     * WHY: Even if some stale browser state triggers a submit, we must never open a
     * WebSocket to localhost:8080 in a production deploy where the server does not exist.
     */
    if (!SYNC_ROOMS_ENABLED) return;

    const code = roomCodeInput.trim().toUpperCase();
    if (!code) return;

    // FIX #2: Resume AudioContext directly during genuine user gesture (Join click)
    try {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
    } catch (err) {
      console.warn("AudioContext resume on join warning:", err);
    }

    if (wsClient) {
      wsClient.close();
    }

    try {
      const ws = new WebSocket("ws://localhost:8080");

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "join", roomCode: code, roomPassword: roomPasswordInput.trim() }));
        setErrorMsg(null);
        performNTPClockSync(ws);
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "error") {
            setErrorMsg(data.message || "Failed to join room.");
            setActiveRoomCode(null);
            ws.close();
            return;
          }

          if (data.type === "sync_state" && data.roomState) {
            setActiveRoomCode(code);
            const { roomState, clientCount } = data;
            console.log("[WS Client] Received sync_state:", roomState);

            if (clientCount !== undefined) setRoomMemberCount(clientCount);

            const remoteTrackA = roomState.currentTrackA;
            const remoteTrackB = roomState.currentTrackB;

            let currentBufA = bufferARef.current;
            let currentBufB = bufferBRef.current;

            // Check if track A or B audioUrl changed from current state
            setTrackA((prev) => {
              if (remoteTrackA?.audioUrl && remoteTrackA.audioUrl !== prev.audioUrl) {
                setBufferA(null);
                currentBufA = null;
              }
              return remoteTrackA?.name ? remoteTrackA : prev;
            });

            setTrackB((prev) => {
              if (remoteTrackB?.audioUrl && remoteTrackB.audioUrl !== prev.audioUrl) {
                setBufferB(null);
                currentBufB = null;
              }
              return remoteTrackB?.name ? remoteTrackB : prev;
            });

            // Fetch and decode missing buffers
            if (remoteTrackA?.audioUrl && !currentBufA) {
              setLoadingLeft(true);
              try {
                currentBufA = await decodeAudioUrl(remoteTrackA.audioUrl);
                setBufferA(currentBufA);
              } catch (err) {
                console.error("Failed decoding left track on sync_state:", err);
              } finally {
                setLoadingLeft(false);
              }
            }

            if (remoteTrackB?.audioUrl && !currentBufB) {
              setLoadingRight(true);
              try {
                currentBufB = await decodeAudioUrl(remoteTrackB.audioUrl);
                setBufferB(currentBufB);
              } catch (err) {
                console.error("Failed decoding right track on sync_state:", err);
              } finally {
                setLoadingRight(false);
              }
            }

            // Handle room playback status
            if (roomState.status === "stopped") {
              stopPlayback();
              setPlaybackState("stopped");
            } else if (roomState.status === "paused") {
              await pausePlayback();
              setPlaybackState("paused");
            } else if (roomState.status === "playing") {
              const ctx = getAudioContext();
              if (ctx.state === "suspended") {
                await ctx.resume();
              }

              // Calculate elapsed track position in milliseconds
              // localStartMs = playbackStartServerTime - clockOffsetMs
              const localStartMs = roomState.playbackStartServerTime - clockOffsetMs;
              const nowMs = Date.now();
              const elapsedMs = (nowMs - localStartMs) + (roomState.pausedElapsedMs || 0);

              if (elapsedMs < 0) {
                // Scheduled start is in the future
                const targetAudioCtxTime = ctx.currentTime + Math.abs(elapsedMs) / 1000;
                if (currentBufA && currentBufB) {
                  playStereoSplit(currentBufA, currentBufB, targetAudioCtxTime, 0);
                  setPlaybackState("playing");
                }
              } else {
                // Mid-song join or active playback offset: start immediately with offsetSeconds
                const offsetSeconds = elapsedMs / 1000;
                const targetAudioCtxTime = ctx.currentTime + 0.05;

                console.log(`[WS Client Mid-Song Join] Offset: ${offsetSeconds.toFixed(2)}s into track`);

                if (currentBufA && currentBufB) {
                  playStereoSplit(currentBufA, currentBufB, targetAudioCtxTime, offsetSeconds);
                  setPlaybackState("playing");
                }
              }
            }
          }
        } catch (err) {
          console.error("WS message processing error:", err);
        }
      };

      ws.onerror = () => {
        setErrorMsg("Failed to connect to WebSocket Room Server on ws://localhost:8080. Ensure ws-server is running.");
      };

      setWsClient(ws);
    } catch (err) {
      setErrorMsg(`WebSocket error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * Initiates room-wide synchronized playback by broadcasting to WebSocket room.
   */
  const handleRoomStartPlayback = () => {
    if (!bufferA || !bufferB) {
      setErrorMsg("Please load both Left and Right tracks before initiating room playback.");
      return;
    }

    if (wsClient && activeRoomCode && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(
        JSON.stringify({
          type: "start_playback",
          roomCode: activeRoomCode,
          trackA,
          trackB,
        })
      );
      savePairingInBackground();
    } else {
      handlePlay();
    }
  };

  /**
   * Updates Left ear volume level in real time.
   * @param {number} val - Volume scale from 0 to 100.
   */
  const handleLeftVolChange = (val: number) => {
    setLeftVol(val);
    setLeftVolume(val / 100);
  };

  /**
   * Updates Right ear volume level in real time.
   * @param {number} val - Volume scale from 0 to 100.
   */
  const handleRightVolChange = (val: number) => {
    setRightVol(val);
    setRightVolume(val / 100);
  };

  /**
   * WHAT: Validates file MIME type and size before decoding for the LEFT ear.
   * WHY (security): The `accept="audio/*"` HTML attribute is browser-enforced only and is trivially
   * bypassed — a user can rename any file to `.mp3` and the browser will pass it through.
   * Checking `file.type` against the allowlist rejects non-audio MIME types as an early guard.
   * `decodeAudioData` provides the hard server-side rejection: it will throw on non-audio byte streams.
   * File size cap (MAX_UPLOAD_BYTES) prevents a multi-GB file from consuming all browser heap memory
   * during `file.arrayBuffer()` before the decode even starts.
   */
  const handleFileAChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // Client-side security guard 1: MIME type allowlist
    const ALLOWED_AUDIO_MIME_TYPES = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg",
      "audio/flac", "audio/aac", "audio/x-m4a", "audio/mp4", "audio/webm",
    ];
    if (selected.type && !ALLOWED_AUDIO_MIME_TYPES.includes(selected.type)) {
      setErrorMsg(`Rejected: "${selected.name}" has MIME type "${selected.type}" which is not a supported audio format. Please upload an MP3, WAV, OGG, or FLAC file.`);
      e.target.value = "";
      return;
    }

    // Client-side security guard 2: File size cap (50 MB)
    const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
    if (selected.size > MAX_UPLOAD_BYTES) {
      setErrorMsg(`Rejected: "${selected.name}" is ${(selected.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed upload size is 50 MB.`);
      e.target.value = "";
      return;
    }

    setTrackA({ name: selected.name, source: "upload" });
    setLoadingLeft(true);
    setErrorMsg(null);
    try {
      // decodeAudioData provides hard rejection: throws on non-audio byte content
      const decoded = await decodeAudioFile(selected);
      setBufferA(decoded);
    } catch (err) {
      setErrorMsg(`Failed to decode Left audio file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingLeft(false);
    }
  };

  /**
   * WHAT: Validates file MIME type and size before decoding for the RIGHT ear.
   * WHY (security): Same rationale as handleFileAChange — MIME type allowlist + 50 MB cap
   * prevent non-audio file uploads from consuming browser memory or bypassing the accept attribute.
   */
  const handleFileBChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const ALLOWED_AUDIO_MIME_TYPES = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg",
      "audio/flac", "audio/aac", "audio/x-m4a", "audio/mp4", "audio/webm",
    ];
    if (selected.type && !ALLOWED_AUDIO_MIME_TYPES.includes(selected.type)) {
      setErrorMsg(`Rejected: "${selected.name}" has MIME type "${selected.type}" which is not a supported audio format. Please upload an MP3, WAV, OGG, or FLAC file.`);
      e.target.value = "";
      return;
    }

    const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
    if (selected.size > MAX_UPLOAD_BYTES) {
      setErrorMsg(`Rejected: "${selected.name}" is ${(selected.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed upload size is 50 MB.`);
      e.target.value = "";
      return;
    }

    setTrackB({ name: selected.name, source: "upload" });
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
   * WHY (security): Query length is capped at 200 characters before being forwarded to
   * the upstream Jamendo/Spotify APIs. Although both APIs are called server-side with
   * `encodeURIComponent`, an unbounded query field with injected XSS payloads in track
   * names could theoretically be reflected in error messages. The cap also prevents
   * pointless large payloads from consuming Jamendo/Spotify rate-limit quota.
   */
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Security: cap query length before it is sent to the server/external APIs
    const MAX_QUERY_LENGTH = 200;
    if (searchQuery.trim().length > MAX_QUERY_LENGTH) {
      setErrorMsg(`Search query is too long (max ${MAX_QUERY_LENGTH} characters).`);
      return;
    }

    setIsSearching(true);
    setSearchWarning(null);
    setErrorMsg(null);

    try {
      const route = searchSource === "jamendo" ? "/api/search/jamendo" : "/api/search/spotify";
      const res = await fetch(`${route}?q=${encodeURIComponent(searchQuery)}`);
      
      if (!res.ok) {
        if (res.status === 429) {
          setErrorMsg("Too many search requests. Search is temporarily rate-limited; please try again in a minute.");
        } else {
          setErrorMsg("Search service is temporarily unavailable. Please try again.");
        }
        setSearchResults([]);
        return;
      }

      const data = await res.json();
      setSearchResults(data.results || []);
      if (data.warning) {
        setSearchWarning(data.warning);
      }
    } catch {
      setErrorMsg("Search service is temporarily unavailable. Please check your internet connection and try again.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  /**
  /**
   * Helper to broadcast room WebSocket commands
   */
  const sendRoomCommand = (commandType: string, payload: object = {}) => {
    if (wsClient && activeRoomCode && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(
        JSON.stringify({
          type: commandType,
          roomCode: activeRoomCode,
          ...payload,
        })
      );
      return true;
    }
    return false;
  };

  /**
   * Assigns a Jamendo search result track to the LEFT ear (Channel 0).
   * @param {TrackResult} track - Jamendo track object containing direct audio URL.
   */
  /**
   * Assigns a Jamendo search result track to the LEFT ear (Channel 0).
   * 
   * WHAT: When inside an active room (activeRoomCode is set), sends a `change_tracks` WebSocket command
   * to the server without mutating local track or audio buffer state directly. The server updates the room state
   * and broadcasts `sync_state` back to ALL clients (including sender), ensuring every client updates symmetrically.
   * When NOT in a room, decodes and sets the track locally.
   * 
   * @param {TrackResult} track - Jamendo track object containing direct audio URL.
   */
  const assignJamendoTrackToLeft = async (track: TrackResult) => {
    if (!track.audioUrl) return;

    const newTrackA: TrackMetadata = {
      name: `${track.name} - ${track.artistName}`,
      source: "jamendo",
      id: track.id,
      audioUrl: track.audioUrl,
    };

    // If inside an active room, route through server WS state as single source of truth
    if (activeRoomCode && wsClient && wsClient.readyState === WebSocket.OPEN) {
      sendRoomCommand("change_tracks", {
        trackA: newTrackA,
        trackB,
      });
      return;
    }

    // Direct local selection when NOT in a room
    setLoadingLeft(true);
    setErrorMsg(null);
    setTrackA(newTrackA);
    stopPlayback();
    setPlaybackState("stopped");

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
   * 
   * WHAT: Same pattern as `assignJamendoTrackToLeft` — inside an active room, routes through `change_tracks` WS command.
   * When NOT in a room, updates local state directly.
   * 
   * @param {TrackResult} track - Jamendo track object containing direct audio URL.
   */
  const assignJamendoTrackToRight = async (track: TrackResult) => {
    if (!track.audioUrl) return;

    const newTrackB: TrackMetadata = {
      name: `${track.name} - ${track.artistName}`,
      source: "jamendo",
      id: track.id,
      audioUrl: track.audioUrl,
    };

    // If inside an active room, route through server WS state as single source of truth
    if (activeRoomCode && wsClient && wsClient.readyState === WebSocket.OPEN) {
      sendRoomCommand("change_tracks", {
        trackA,
        trackB: newTrackB,
      });
      return;
    }

    // Direct local selection when NOT in a room
    setLoadingRight(true);
    setErrorMsg(null);
    setTrackB(newTrackB);
    stopPlayback();
    setPlaybackState("stopped");

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
   * Helper to save pairing to history database and store active pairing ID for real-time favoriting.
   * 
   * WHAT: Posts track metadata to `/api/pairings` and sets activePairingId and isFavorite state.
   * WHY: Enables immediate real-time starring/favoriting while listening to the current active session.
   */
  const savePairingInBackground = async () => {
    if (!session?.user) return null;

    try {
      const res = await fetch("/api/pairings", {
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
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pairing) {
          setActivePairingId(data.pairing.id);
          setIsFavorite(Boolean(data.pairing.isFavorite));
          return data.pairing;
        }
      }
    } catch (err) {
      console.error("Pairing save failed:", err);
    }
    return null;
  };

  /**
   * Real-Time In-Player Favorite Toggle Handler.
   * 
   * WHAT: Toggles the `isFavorite` status of the current active session in Supabase database in real time.
   * WHY: Allows users to star/unstar the pairing directly while listening without going to history page.
   */
  const handleToggleFavorite = async () => {
    if (!session?.user) {
      setErrorMsg("Please sign in with Google to star/favorite pairings.");
      return;
    }

    let targetId = activePairingId;

    // If pairing is not saved yet (e.g. user stars before playing), save it now
    if (!targetId) {
      const saved = await savePairingInBackground();
      if (saved) {
        targetId = saved.id;
      } else {
        setErrorMsg("Failed to initialize pairing record for favoriting.");
        return;
      }
    }

    const newFavState = !isFavorite;
    setIsFavorite(newFavState);

    try {
      const res = await fetch(`/api/pairings/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: newFavState }),
      });
      if (!res.ok) {
        setIsFavorite(!newFavState); // Revert on failure
        setErrorMsg("Failed to update favorite status in database.");
      }
    } catch (err) {
      setIsFavorite(!newFavState);
      setErrorMsg(`Favorite error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * Starts simultaneous stereo split audio playback from current state.
   * Uses independent offsets if either seek slider has been moved from zero.
   */
  const handlePlay = () => {
    if (!bufferA || !bufferB) {
      setErrorMsg("Please select and load both Left and Right audio tracks before playing.");
      return;
    }

    if (sendRoomCommand("play", { trackA, trackB })) {
      savePairingInBackground();
    } else {
      try {
        if (seekA > 0 || seekB > 0) {
          playStereoSplitIndependent(bufferA, bufferB, seekA, seekB);
        } else {
          playStereoSplit(bufferA, bufferB);
        }
        setPlaybackState("playing");
        setErrorMsg(null);
        savePairingInBackground();
      } catch (err) {
        setErrorMsg(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  /**
   * Pauses or Resumes audio playback using AudioContext suspend/resume.
   */
  const handleTogglePause = async () => {
    if (playbackState === "playing") {
      if (!sendRoomCommand("pause")) {
        await pausePlayback();
        setPlaybackState("paused");
      }
    } else if (playbackState === "paused") {
      if (!sendRoomCommand("play", { trackA, trackB })) {
        await resumePlayback();
        setPlaybackState("playing");
      }
    }
  };

  /**
   * Restarts active audio playback from the beginning (t = 0).
   */
  const handleRestart = async () => {
    if (!bufferA || !bufferB) return;
    if (!sendRoomCommand("restart", { trackA, trackB })) {
      try {
        await restartPlayback(bufferA, bufferB);
        setPlaybackState("playing");
        setErrorMsg(null);
      } catch (err) {
        setErrorMsg(`Restart error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  /**
   * Stops active audio playback.
   */
  const handleStop = () => {
    if (!sendRoomCommand("stop")) {
      stopPlayback();
      setPlaybackState("stopped");
    }
  };

  /**
   * Clears both Left and Right ear tracks, stopping playback and resetting all track state.
   * WHY: Gives the user a single-click reset for both channels without needing to reload the page.
   */
  const handleClearTracks = () => {
    stopPlayback();
    setPlaybackState("stopped");
    setTrackA({ name: "No track selected", source: "upload" });
    setTrackB({ name: "No track selected", source: "upload" });
    setBufferA(null);
    setBufferB(null);
    setSeekA(0);
    setSeekB(0);
    setActivePairingId(null);
    setIsFavorite(false);
    setErrorMsg(null);
  };

  return (
    <main className="min-h-screen bg-[#f5f0eb] text-[#1c1917] flex flex-col items-center p-6 space-y-4">

      {/* Top Navigation Bar */}
      <div className="max-w-3xl w-full border border-[#d4c8bc] bg-[#eae3db] p-4 flex items-center justify-between shadow-[2px_2px_0px_0px_#1c1917]">
        <Link href="/" className="font-bold text-[#dc2626] tracking-widest text-sm uppercase" style={{ fontFamily: "var(--font-pixelify), monospace" }}>
          DUAL
        </Link>

        <div className="flex items-center gap-3">
          {status === "loading" ? (
            <div className="text-xs text-[#78716c]">Checking auth...</div>
          ) : session?.user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {session.user.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user.name || "User Avatar"}
                    className="w-6 h-6 border border-[#d4c8bc] object-cover"
                  />
                ) : (
                  <div className="w-6 h-6 bg-[#dc2626] flex items-center justify-center font-bold text-xs text-white">
                    {session.user.name?.charAt(0) || "U"}
                  </div>
                )}
                <span className="text-xs font-semibold text-[#1c1917]">{session.user.name || session.user.email}</span>
                <span className="w-1.5 h-1.5 bg-[#22c55e] inline-block" title="Logged in" />
              </div>
              <Link
                href="/history"
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-[#d4c8bc] bg-[#f5f0eb] hover:bg-[#d4c8bc] text-[#1c1917] transition-colors"
              >
                History
              </Link>
              <button
                onClick={() => signOut()}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-white transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#78716c]">Sign in to save pairings</span>
              <button
                onClick={() => signIn("google")}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-[#dc2626] hover:bg-[#b91c1c] text-white border border-[#1c1917] shadow-[2px_2px_0px_0px_#1c1917] transition-colors"
              >
                Sign In with Google
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="max-w-3xl w-full border border-[#dc2626] bg-[#fee2e2] p-4 text-[#dc2626] text-sm font-medium">
          {errorMsg}
        </div>
      )}

      {/* AI Vibe-Based Pairing Section */}
      <div className="max-w-3xl w-full border border-[#d4c8bc] bg-[#eae3db] p-6 space-y-4 shadow-[2px_2px_0px_0px_#1c1917]">
        <div className="border-b border-[#d4c8bc] pb-3 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-[#1c1917] uppercase tracking-wider">
              AI Vibe-Based Pairing
            </h3>
            <p className="text-xs text-[#78716c] mt-0.5">
              Describe a mood or atmosphere to auto-generate a complementary Left & Right stereo pair.
            </p>
          </div>
        </div>

        <form onSubmit={handleVibeSuggest} className="flex gap-3">
          <input
            type="text"
            value={vibeInput}
            onChange={(e) => setVibeInput(e.target.value)}
            placeholder="What vibe are you feeling? (e.g. focused and productive, rainy midnight jazz)"
            id="vibe-input"
            disabled={isVibeLoading}
            className="flex-1 bg-[#f5f0eb] border border-[#d4c8bc] px-4 py-2.5 text-sm text-[#1c1917] placeholder-[#78716c] focus:outline-none focus:border-[#dc2626] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isVibeLoading}
            id="vibe-suggest-button"
            className="px-6 py-2.5 bg-[#1c1917] hover:bg-[#78716c] text-white text-sm font-bold uppercase tracking-wider border border-[#1c1917] shadow-[2px_2px_0px_0px_#1c1917] disabled:opacity-50 transition-colors"
          >
            {isVibeLoading ? "Suggesting..." : "Suggest"}
          </button>
        </form>

        {vibeError && (
          <div className="border border-[#dc2626] bg-[#fee2e2] p-3 text-[#dc2626] text-xs font-medium">
            {vibeError}
          </div>
        )}

        {vibeReasoning && (
          <div className="space-y-4 pt-1">
            <div className="border border-[#d4c8bc] bg-[#f5f0eb] p-3 text-xs text-[#1c1917] font-mono leading-relaxed">
              <span className="font-bold text-[#dc2626] uppercase tracking-wider block mb-1">AI Reasoning:</span>
              {vibeReasoning}
            </div>

            {vibeBpmWarning && (
              <div className="border border-[#dc2626] bg-[#fee2e2] p-3 text-[#dc2626] text-xs font-medium font-mono">
                {vibeBpmWarning}
              </div>
            )}

            {vibeBestPair && (
              <div className="border border-[#1c1917] bg-[#eae3db] p-3 text-xs space-y-2">
                <div className="flex items-center justify-between border-b border-[#d4c8bc] pb-1.5 font-bold uppercase tracking-wider text-[#1c1917]">
                  <span>Optimal BPM Pair (Matched within 15 BPM)</span>
                  <span className="text-[#dc2626] font-mono">Tempo Diff: {vibeBestPair.diff} BPM</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#f5f0eb] border border-[#d4c8bc] p-2 flex items-center justify-between">
                    <div className="truncate">
                      <div className="font-semibold text-[#1c1917] truncate">{vibeBestPair.trackA.name}</div>
                      <div className="text-[10px] text-[#78716c] font-mono">Left • {(vibeBestPair.trackA as unknown as { bpm?: number }).bpm || 120} BPM</div>
                    </div>
                    <button
                      onClick={() => assignJamendoTrackToLeft(vibeBestPair.trackA)}
                      className={`px-2 py-1 text-[10px] font-bold uppercase border transition-colors ${
                        trackA.id === vibeBestPair.trackA.id
                          ? "bg-[#dc2626] border-[#dc2626] text-white"
                          : "border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-white"
                      }`}
                    >
                      {trackA.id === vibeBestPair.trackA.id ? "In Left" : "+ Left"}
                    </button>
                  </div>
                  <div className="bg-[#f5f0eb] border border-[#d4c8bc] p-2 flex items-center justify-between">
                    <div className="truncate">
                      <div className="font-semibold text-[#1c1917] truncate">{vibeBestPair.trackB.name}</div>
                      <div className="text-[10px] text-[#78716c] font-mono">Right • {(vibeBestPair.trackB as unknown as { bpm?: number }).bpm || 120} BPM</div>
                    </div>
                    <button
                      onClick={() => assignJamendoTrackToRight(vibeBestPair.trackB)}
                      className={`px-2 py-1 text-[10px] font-bold uppercase border transition-colors ${
                        trackB.id === vibeBestPair.trackB.id
                          ? "bg-[#1c1917] border-[#1c1917] text-white"
                          : "border-[#1c1917] text-[#1c1917] hover:bg-[#1c1917] hover:text-white"
                      }`}
                    >
                      {trackB.id === vibeBestPair.trackB.id ? "In Right" : "+ Right"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Side AI Suggestions */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#dc2626] border-b border-[#d4c8bc] pb-1 flex justify-between">
                  <span>Left Ear ({vibeQueryA})</span>
                  <span>{vibeResultsA.length} matches</span>
                </div>
                {vibeResultsA.length === 0 ? (
                  <div className="text-xs text-[#78716c] p-2 bg-[#f5f0eb] border border-[#d4c8bc]">
                    No matches found for this suggestion, try a different vibe
                  </div>
                ) : (
                  vibeResultsA.map((track) => (
                    <div
                      key={`ai-left-${track.id}`}
                      className="bg-[#f5f0eb] border border-[#d4c8bc] hover:border-[#dc2626] p-2.5 flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <img
                          src={track.albumArt}
                          alt={track.name}
                          className="w-9 h-9 object-cover bg-[#d4c8bc] border border-[#d4c8bc] flex-shrink-0"
                        />
                        <div className="truncate text-xs">
                          <div className="font-semibold text-[#1c1917] truncate">{track.name}</div>
                          <div className="text-[#78716c] truncate text-[11px]">{track.artistName}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => assignJamendoTrackToLeft(track)}
                        className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border transition-colors flex-shrink-0 ml-2 ${
                          trackA.id === track.id
                            ? "bg-[#dc2626] border-[#dc2626] text-white"
                            : "border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-white"
                        }`}
                      >
                        {trackA.id === track.id ? "In Left" : "+ Left"}
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Right Side AI Suggestions */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#1c1917] border-b border-[#d4c8bc] pb-1 flex justify-between">
                  <span>Right Ear ({vibeQueryB})</span>
                  <span>{vibeResultsB.length} matches</span>
                </div>
                {vibeResultsB.length === 0 ? (
                  <div className="text-xs text-[#78716c] p-2 bg-[#f5f0eb] border border-[#d4c8bc]">
                    No matches found for this suggestion, try a different vibe
                  </div>
                ) : (
                  vibeResultsB.map((track) => (
                    <div
                      key={`ai-right-${track.id}`}
                      className="bg-[#f5f0eb] border border-[#d4c8bc] hover:border-[#1c1917] p-2.5 flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <img
                          src={track.albumArt}
                          alt={track.name}
                          className="w-9 h-9 object-cover bg-[#d4c8bc] border border-[#d4c8bc] flex-shrink-0"
                        />
                        <div className="truncate text-xs">
                          <div className="font-semibold text-[#1c1917] truncate">{track.name}</div>
                          <div className="text-[#78716c] truncate text-[11px]">{track.artistName}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => assignJamendoTrackToRight(track)}
                        className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border transition-colors flex-shrink-0 ml-2 ${
                          trackB.id === track.id
                            ? "bg-[#1c1917] border-[#1c1917] text-white"
                            : "border-[#1c1917] text-[#1c1917] hover:bg-[#1c1917] hover:text-white"
                        }`}
                      >
                        {trackB.id === track.id ? "In Right" : "+ Right"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Verified Named Song Recommendations (Spotify Metadata) */}
            {vibeNamedSongs.length > 0 && (
              <div className="border-t border-[#d4c8bc] pt-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#1c1917]">
                  If you own these, they'd pair well:
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {vibeNamedSongs.map((song, idx) => (
                    <div
                      key={`verified-song-${idx}`}
                      className="bg-[#f5f0eb] border border-[#d4c8bc] p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <img
                          src={song.albumArt}
                          alt={song.title}
                          className="w-10 h-10 object-cover bg-[#d4c8bc] border border-[#d4c8bc] flex-shrink-0"
                        />
                        <div className="truncate text-xs">
                          <div className="font-semibold text-[#1c1917] truncate">{song.title}</div>
                          <div className="text-[#78716c] truncate">{song.artist}</div>
                          <span className="inline-block mt-0.5 text-[10px] font-bold text-[#78716c] border border-[#d4c8bc] bg-[#eae3db] px-1.5 py-0.5 uppercase tracking-wider">
                            Reference Only — Not Playable in-app
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Track Channel Cards (Positioned ABOVE Find & Load Music Tracks) */}
      <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Ear Channel */}
        <div className="border border-[#d4c8bc] bg-[#eae3db] text-[#1c1917] p-6 space-y-4 shadow-[2px_2px_0px_0px_#1c1917]">
          <div className="flex items-center justify-between border-b border-[#d4c8bc] pb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-[#dc2626] inline-block" />
              <h2 className="font-bold text-xs tracking-widest uppercase text-[#dc2626]">
                Left Ear Track
              </h2>
            </div>
            {loadingLeft && <span className="text-xs text-[#78716c] animate-pulse">Loading PCM...</span>}
          </div>

          <div className="border border-[#d4c8bc] bg-[#f5f0eb] p-3 text-xs font-mono truncate text-[#1c1917]">
            {trackA.name}
          </div>

          {/* Seek scrub bar — shown only when a track is loaded */}
          {bufferA && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-[#78716c]">
                <span>{fmt(Math.min(seekA, bufferA.duration || 0))}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#78716c]">Position</span>
                <span>{fmt(bufferA.duration || 0)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={bufferA.duration > 0 ? bufferA.duration : 1}
                step="0.1"
                value={Math.min(Math.max(0, seekA || 0), bufferA.duration > 0 ? bufferA.duration : 1)}
                id="left-seek-slider"
                onMouseDown={() => { isScrubbingA.current = true; }}
                onTouchStart={() => { isScrubbingA.current = true; }}
                onChange={(e) => setSeekA(Number(e.target.value))}
                onMouseUp={(e) => handleSeekA(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleSeekA(Number((e.target as HTMLInputElement).value))}
                className="w-full accent-[#dc2626] h-1.5 cursor-pointer"
              />
            </div>
          )}

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold text-[#78716c]">
              <span>Left Volume</span>
              <span>{leftVol}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={leftVol}
              onChange={(e) => handleLeftVolChange(Number(e.target.value))}
              id="left-volume-slider"
              className="w-full accent-[#dc2626] h-1 cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 uppercase tracking-wider text-[#78716c]">
              Upload Custom File
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileAChange}
              id="left-file-input"
              className="block w-full text-xs text-[#78716c] cursor-pointer file:mr-3 file:py-1.5 file:px-3 file:border file:border-[#1c1917] file:text-xs file:font-bold file:uppercase file:tracking-wider file:bg-[#dc2626] file:text-white hover:file:bg-[#b91c1c]"
            />
          </div>
        </div>

        {/* Right Ear Channel */}
        <div className="border border-[#d4c8bc] bg-[#eae3db] text-[#1c1917] p-6 space-y-4 shadow-[2px_2px_0px_0px_#1c1917]">
          <div className="flex items-center justify-between border-b border-[#d4c8bc] pb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-[#1c1917] inline-block" />
              <h2 className="font-bold text-xs tracking-widest uppercase text-[#1c1917]">
                Right Ear Track
              </h2>
            </div>
            {loadingRight && <span className="text-xs text-[#78716c] animate-pulse">Loading PCM...</span>}
          </div>

          <div className="border border-[#d4c8bc] bg-[#f5f0eb] p-3 text-xs font-mono truncate text-[#1c1917]">
            {trackB.name}
          </div>

          {/* Seek scrub bar — shown only when a track is loaded */}
          {bufferB && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-[#78716c]">
                <span>{fmt(Math.min(seekB, bufferB.duration || 0))}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#78716c]">Position</span>
                <span>{fmt(bufferB.duration || 0)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={bufferB.duration > 0 ? bufferB.duration : 1}
                step="0.1"
                value={Math.min(Math.max(0, seekB || 0), bufferB.duration > 0 ? bufferB.duration : 1)}
                id="right-seek-slider"
                onMouseDown={() => { isScrubbingB.current = true; }}
                onTouchStart={() => { isScrubbingB.current = true; }}
                onChange={(e) => setSeekB(Number(e.target.value))}
                onMouseUp={(e) => handleSeekB(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleSeekB(Number((e.target as HTMLInputElement).value))}
                className="w-full accent-[#1c1917] h-1.5 cursor-pointer"
              />
            </div>
          )}

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold text-[#78716c]">
              <span>Right Volume</span>
              <span>{rightVol}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={rightVol}
              onChange={(e) => handleRightVolChange(Number(e.target.value))}
              id="right-volume-slider"
              className="w-full accent-[#dc2626] h-1 cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 uppercase tracking-wider text-[#78716c]">
              Upload Custom File
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileBChange}
              id="right-file-input"
              className="block w-full text-xs text-[#78716c] cursor-pointer file:mr-3 file:py-1.5 file:px-3 file:border file:border-[#1c1917] file:text-xs file:font-bold file:uppercase file:tracking-wider file:bg-[#1c1917] file:text-white hover:file:bg-[#78716c]"
            />
          </div>
        </div>
      </div>

      {/* Playback Control Bar */}
      <div className="max-w-3xl w-full border border-[#d4c8bc] bg-[#eae3db] p-4 flex flex-wrap items-center justify-center gap-3 shadow-[2px_2px_0px_0px_#1c1917]">
        <button
          onClick={handlePlay}
          disabled={!bufferA || !bufferB}
          id="play-button"
          className="px-6 py-2.5 font-bold text-sm uppercase tracking-wider bg-[#dc2626] hover:bg-[#b91c1c] text-white border border-[#1c1917] shadow-[3px_3px_0px_0px_#1c1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#1c1917] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Play Stereo Split
        </button>

        <button
          onClick={handleTogglePause}
          disabled={playbackState === "stopped"}
          id="pause-resume-button"
          className="px-5 py-2.5 font-bold text-sm uppercase tracking-wider border border-[#1c1917] bg-[#f5f0eb] hover:bg-[#d4c8bc] text-[#1c1917] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {playbackState === "paused" ? "Resume" : "Pause"}
        </button>

        <button
          onClick={handleRestart}
          disabled={!bufferA || !bufferB || playbackState === "stopped"}
          id="restart-button"
          className="px-5 py-2.5 font-bold text-sm uppercase tracking-wider border border-[#1c1917] bg-[#f5f0eb] hover:bg-[#d4c8bc] text-[#1c1917] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Restart
        </button>

        <button
          onClick={handleToggleFavorite}
          disabled={!bufferA || !bufferB}
          id="favorite-button"
          title={isFavorite ? "Remove from Favorites" : "Save to Favorites"}
          className={`px-5 py-2.5 font-bold text-sm uppercase tracking-wider border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isFavorite
              ? "bg-[#dc2626] border-[#dc2626] text-white"
              : "bg-[#f5f0eb] border-[#1c1917] text-[#1c1917] hover:bg-[#d4c8bc]"
          }`}
        >
          {isFavorite ? "Favorited" : "Favorite"}
        </button>

        <button
          onClick={handleStop}
          disabled={playbackState === "stopped"}
          id="stop-button"
          className="px-5 py-2.5 font-bold text-sm uppercase tracking-wider border border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Stop
        </button>

        <button
          onClick={handleClearTracks}
          disabled={trackA.name === "No track selected" && trackB.name === "No track selected"}
          id="clear-tracks-button"
          title="Clear both Left and Right tracks"
          className="px-5 py-2.5 font-bold text-sm uppercase tracking-wider border border-[#78716c] text-[#78716c] hover:bg-[#78716c] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Playback Status Indicator */}
      <div className="max-w-3xl w-full text-center text-xs font-mono p-3 border border-[#d4c8bc] bg-[#eae3db]">
        {playbackState === "playing" && (
          <span className="text-[#22c55e] font-bold uppercase tracking-wider">
            Playing — Left: {trackA.name} | Right: {trackB.name}
          </span>
        )}
        {playbackState === "paused" && (
          <span className="text-[#78716c] font-bold uppercase tracking-wider">
            Paused
          </span>
        )}
        {playbackState === "stopped" && (
          <span className="text-[#78716c] uppercase tracking-wider">
            Stopped — Select tracks to begin
          </span>
        )}
      </div>

      {/* Search Section */}
      <div className="max-w-3xl w-full border border-[#d4c8bc] bg-[#eae3db] p-6 space-y-5 shadow-[2px_2px_0px_0px_#1c1917]">
        <div className="flex items-center justify-between border-b border-[#d4c8bc] pb-4">
          <h3 className="font-bold text-sm text-[#1c1917] uppercase tracking-wider">Find & Load Music Tracks</h3>

          <div className="flex border border-[#d4c8bc] overflow-hidden">
            <button
              type="button"
              onClick={() => setSearchSource("jamendo")}
              id="source-jamendo-tab"
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                searchSource === "jamendo"
                  ? "bg-[#dc2626] text-white"
                  : "bg-[#f5f0eb] text-[#78716c] hover:text-[#1c1917]"
              }`}
            >
              Jamendo
            </button>
            <button
              type="button"
              onClick={() => setSearchSource("spotify")}
              id="source-spotify-tab"
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                searchSource === "spotify"
                  ? "bg-[#1c1917] text-white"
                  : "bg-[#f5f0eb] text-[#78716c] hover:text-[#1c1917]"
              }`}
            >
              Spotify
            </button>
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex gap-3 relative" ref={genreDropdownRef}>
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (searchSource === "jamendo") {
                  setIsGenreDropdownOpen(true);
                }
              }}
              onFocus={() => {
                if (searchSource === "jamendo") {
                  setIsGenreDropdownOpen(true);
                }
              }}
              placeholder={
                searchSource === "jamendo"
                  ? "Search or select a genre (e.g. ambient, rock, electronic)..."
                  : "Search Spotify catalog (metadata only)..."
              }
              id="search-input"
              className="w-full bg-[#f5f0eb] border border-[#d4c8bc] px-4 py-2.5 text-sm text-[#1c1917] placeholder-[#78716c] focus:outline-none focus:border-[#dc2626]"
            />

            {/* Jamendo Genre Dropdown Menu */}
            {searchSource === "jamendo" && isGenreDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#f5f0eb] border border-[#1c1917] max-h-56 overflow-y-auto z-50 shadow-[3px_3px_0px_0px_#1c1917]">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-[#eae3db] text-[#78716c] border-b border-[#d4c8bc]">
                  Select Genre or Type custom search:
                </div>
                {filteredGenres.length === 0 ? (
                  <div className="px-4 py-2.5 text-xs text-[#78716c]">
                    No matching genres found. Press Search to search by keyphrase.
                  </div>
                ) : (
                  filteredGenres.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => {
                        setSearchQuery(genre);
                        setIsGenreDropdownOpen(false);
                        triggerSearchForQuery(genre);
                      }}
                      className="w-full text-left px-4 py-2 text-xs font-mono text-[#1c1917] hover:bg-[#dc2626] hover:text-white transition-colors border-b border-[#d4c8bc]/40 last:border-0"
                    >
                      {genre}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching}
            id="search-button"
            className="px-6 py-2.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-sm font-bold uppercase tracking-wider border border-[#1c1917] shadow-[2px_2px_0px_0px_#1c1917] disabled:opacity-50 transition-colors"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchWarning && (
          <div className="border border-[#d4c8bc] bg-[#f5f0eb] p-3 text-[#78716c] text-xs">
            {searchWarning}
          </div>
        )}

        <div className="space-y-2 pt-1">
          {searchResults.length === 0 && !isSearching && (
            <div className="text-center text-xs text-[#78716c] py-6 uppercase tracking-wider">
              Enter a search term or pick a genre above to find tracks.
            </div>
          )}

          {searchResults.map((track) => (
            <div
              key={track.id}
              className="bg-[#f5f0eb] border border-[#d4c8bc] hover:border-[#1c1917] p-3 flex items-center justify-between transition-colors"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <img
                  src={track.albumArt}
                  alt={track.name}
                  className="w-10 h-10 object-cover bg-[#d4c8bc] flex-shrink-0 border border-[#d4c8bc]"
                />
                <div className="truncate text-xs">
                  <div className="font-semibold text-[#1c1917] truncate">{track.name}</div>
                  <div className="text-[#78716c] truncate">{track.artistName}</div>
                  {!track.isPlayable && (
                    <span className="inline-block mt-1 text-[10px] font-bold text-[#78716c] border border-[#d4c8bc] bg-[#eae3db] px-2 py-0.5 uppercase tracking-wider">
                      Metadata Only — Not Playable
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {track.isPlayable ? (
                  <>
                    <button
                      onClick={() => assignJamendoTrackToLeft(track)}
                      className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-colors ${
                        trackA.id === track.id
                          ? "bg-[#dc2626] border-[#dc2626] text-white"
                          : "border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-white"
                      }`}
                    >
                      {trackA.id === track.id ? "In Left" : "+ Left"}
                    </button>
                    <button
                      onClick={() => assignJamendoTrackToRight(track)}
                      className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-colors ${
                        trackB.id === track.id
                          ? "bg-[#1c1917] border-[#1c1917] text-white"
                          : "border-[#1c1917] text-[#1c1917] hover:bg-[#1c1917] hover:text-white"
                      }`}
                    >
                      {trackB.id === track.id ? "In Right" : "+ Right"}
                    </button>
                  </>
                ) : (
                  <button
                    disabled
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-[#d4c8bc] text-[#78716c] cursor-not-allowed"
                  >
                    Not Playable
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>


      {/* DUAL Party Room (Positioned BELOW controls & search) — gated by env flag */}
      {/*
       * WHAT: Renamed to DUAL party room and positioned after search/playback.
       * Conditionally rendered ONLY when NEXT_PUBLIC_SYNC_ROOMS_ENABLED is set to "true".
       */}
      {SYNC_ROOMS_ENABLED && (
        <div className="max-w-3xl w-full border border-[#d4c8bc] bg-[#eae3db] p-5 space-y-4 shadow-[2px_2px_0px_0px_#1c1917]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d4c8bc] pb-3">
            <h3 className="font-bold text-sm text-[#1c1917] uppercase tracking-wider">
              DUAL party room
            </h3>
            {activeRoomCode && (
              <div className="flex items-center gap-2 text-xs font-mono border border-[#d4c8bc] bg-[#f5f0eb] px-3 py-1 text-[#1c1917]">
                <span className="w-2 h-2 bg-[#22c55e] inline-block animate-ping" />
                <span>Room: {activeRoomCode}</span>
                <span className="text-[#78716c]">|</span>
                <span>Members: {roomMemberCount}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleJoinRoom} className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Room Code (e.g. ROOM-101)"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              id="room-code-input"
              className="flex-1 min-w-[160px] bg-[#f5f0eb] border border-[#d4c8bc] px-4 py-2 text-xs text-[#1c1917] focus:outline-none focus:border-[#dc2626] font-mono"
            />
            <input
              type="password"
              placeholder="Room Password (optional)"
              value={roomPasswordInput}
              onChange={(e) => setRoomPasswordInput(e.target.value)}
              id="room-password-input"
              className="flex-1 min-w-[160px] bg-[#f5f0eb] border border-[#d4c8bc] px-4 py-2 text-xs text-[#1c1917] focus:outline-none focus:border-[#dc2626] font-mono"
            />
            <button
              type="submit"
              id="join-room-button"
              className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-[#1c1917] hover:bg-[#78716c] text-white border border-[#1c1917] transition-colors"
            >
              {activeRoomCode ? "Switch Room" : "Join Room"}
            </button>
            <button
              type="button"
              onClick={() => {
                const randomCode = `ROOM-${Math.floor(1000 + Math.random() * 9000)}`;
                setRoomCodeInput(randomCode);
                setTimeout(() => {
                  const joinBtn = document.getElementById("join-room-button");
                  joinBtn?.click();
                }, 50);
              }}
              id="create-room-button"
              className="px-5 py-2 text-xs font-bold uppercase tracking-wider border border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-white transition-colors"
            >
              Create New Room
            </button>
          </form>

          {activeRoomCode && (
            <div className="bg-[#f5f0eb] border border-[#d4c8bc] p-3 flex flex-wrap items-center justify-between text-xs font-mono text-[#78716c] gap-2">
              <div className="flex items-center gap-3">
                {isSyncingClock ? (
                  <span className="text-[#dc2626] animate-pulse">Calculating NTP Clock Offset...</span>
                ) : (
                  <>
                    <span className="text-[#1c1917]">NTP Offset: {clockOffsetMs}ms</span>
                    <span>|</span>
                    <span className="text-[#1c1917]">Latency: {avgLatencyMs}ms</span>
                  </>
                )}
              </div>
              <button
                onClick={handleRoomStartPlayback}
                disabled={!bufferA || !bufferB || isSyncingClock}
                id="room-start-button"
                className="px-4 py-1.5 font-bold text-xs uppercase tracking-wider bg-[#dc2626] hover:bg-[#b91c1c] text-white border border-[#1c1917] shadow-[2px_2px_0px_0px_#1c1917] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Start Synchronized Playback
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
