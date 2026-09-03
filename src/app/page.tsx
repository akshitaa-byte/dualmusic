"use client";

import React, { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { decodeAudioFile, playStereoSplit, stopPlayback } from "@/lib/audioEngine";

/**
 * Phase 2 Test Page for Stereo Split Audio Engine & Auth Session.
 * 
 * WHAT: Combines Phase 1 dual-channel audio engine playback with NextAuth.js Google Authentication state.
 * Displays user profile credentials (name, email, avatar, user ID) when logged in.
 * 
 * WHY: Validates end-to-end integration of Web Audio API stereo split functionality alongside NextAuth session handling.
 */
export default function HomePage() {
  const { data: session, status } = useSession();

  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [bufferA, setBufferA] = useState<AudioBuffer | null>(null);
  const [bufferB, setBufferB] = useState<AudioBuffer | null>(null);
  
  const [loadingLeft, setLoadingLeft] = useState<boolean>(false);
  const [loadingRight, setLoadingRight] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /**
   * Handles selection and decoding of the file designated for the LEFT ear.
   * @param {React.ChangeEvent<HTMLInputElement>} e - File input change event.
   */
  const handleFileAChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFileA(selected);
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
   * Handles selection and decoding of the file designated for the RIGHT ear.
   * @param {React.ChangeEvent<HTMLInputElement>} e - File input change event.
   */
  const handleFileBChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFileB(selected);
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
   * Starts simultaneous stereo split audio playback.
   */
  const handlePlay = () => {
    if (!bufferA || !bufferB) {
      setErrorMsg("Please select and load both Left and Right audio files before playing.");
      return;
    }
    try {
      playStereoSplit(bufferA, bufferB);
      setIsPlaying(true);
      setErrorMsg(null);
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
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 space-y-6">
      {/* User Authentication Header */}
      <div className="max-w-xl w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
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
              {session.user.id && (
                <div className="text-slate-500 font-mono text-[10px] mt-0.5">ID: {session.user.id}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            Sign in to sync your audio pairings across devices.
          </div>
        )}

        <div>
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

      {/* Audio Engine Testing Card */}
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
            Stereo Split Music Player
          </h1>
          <p className="text-sm text-slate-400">
            Phase 2: Core Audio Engine + NextAuth Session
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left Channel Control */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 space-y-3">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-blue-500 inline-block animate-pulse" />
              <h2 className="font-semibold text-blue-400 text-sm tracking-wide uppercase">
                Left Ear Track
              </h2>
            </div>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileAChange}
              id="left-file-input"
              className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
            />
            <div className="text-xs text-slate-500">
              {loadingLeft ? (
                <span className="text-amber-400">Decoding PCM buffer...</span>
              ) : fileA ? (
                <span className="text-slate-300 truncate block">{fileA.name}</span>
              ) : (
                "No file selected"
              )}
            </div>
          </div>

          {/* Right Channel Control */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 space-y-3">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-purple-500 inline-block animate-pulse" />
              <h2 className="font-semibold text-purple-400 text-sm tracking-wide uppercase">
                Right Ear Track
              </h2>
            </div>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileBChange}
              id="right-file-input"
              className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-500 cursor-pointer"
            />
            <div className="text-xs text-slate-500">
              {loadingRight ? (
                <span className="text-amber-400">Decoding PCM buffer...</span>
              ) : fileB ? (
                <span className="text-slate-300 truncate block">{fileB.name}</span>
              ) : (
                "No file selected"
              )}
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-center space-x-4 pt-2">
          <button
            onClick={handlePlay}
            disabled={!bufferA || !bufferB}
            id="play-button"
            className="px-6 py-3 rounded-xl font-medium text-sm transition-all duration-200 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-900/30"
          >
            Play Stereo Split
          </button>
          <button
            onClick={handleStop}
            disabled={!isPlaying}
            id="stop-button"
            className="px-6 py-3 rounded-xl font-medium text-sm transition-all duration-200 border border-slate-700 hover:bg-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Stop
          </button>
        </div>

        {isPlaying && (
          <div className="text-center text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-lg p-2 animate-pulse">
            ● Synchronized Playback Active (Left: {fileA?.name} | Right: {fileB?.name})
          </div>
        )}
      </div>
    </main>
  );
}
