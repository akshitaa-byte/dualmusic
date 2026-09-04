/**
 * Standalone WebSocket Server for Real-Time Synchronized Listening Rooms (Spotify Jam Model).
 * 
 * WHAT: Manages persistent, shared room states across all connected room members.
 * Supports democratic commands (play, pause, restart, change_tracks) and sends mid-song
 * state synchronization to new/reconnecting clients (`sync_state`).
 * 
 * SECURITY ENHANCEMENTS:
 * 1. Room Passwords: Set by room creator on first join; verified for subsequent joins.
 * 2. Max Occupancy: Enforces max 4 active participants per room.
 * 3. Rate Limiting: Max 10 join attempts per minute per IP address.
 * 4. Zero Credential Exposure: Room passwords are stored in server memory ONLY and are
 *    NEVER included in broadcast `sync_state` payloads or exposed to connected clients.
 */

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

interface TrackMetadata {
  name: string;
  source: "jamendo" | "upload";
  id?: string;
  audioUrl?: string;
}

interface RoomState {
  roomCode: string;
  currentTrackA: TrackMetadata;
  currentTrackB: TrackMetadata;
  status: "playing" | "paused" | "stopped";
  playbackStartServerTime: number;
  pausedElapsedMs: number;
}

// Global server storage
const roomClientsMap = new Map<string, Set<WebSocket>>();
const socketRoomMap = new WeakMap<WebSocket, string>();
const roomStatesMap = new Map<string, RoomState>();

/**
 * Server-only room password storage.
 * WHY (security): Kept in a separate private Map completely detached from `RoomState`,
 * ensuring it can NEVER be serialized or leaked into `sync_state` broadcasts.
 */
const roomPasswordsMap = new Map<string, string>();

/**
 * In-memory IP rate limiter for WebSocket join attempts.
 * Limit: 10 join attempts per 60 seconds per IP address.
 */
interface IpJoinRecord {
  count: number;
  resetTime: number;
}
const joinRateLimitMap = new Map<string, IpJoinRecord>();

console.log(`[WebSocket Server] Secure Spotify Jam style room server running on ws://localhost:${PORT}`);

/**
 * Checks whether an IP address has exceeded join attempt rate limits.
 * @param ip - Client IP address string
 * @returns boolean true if permitted, false if rate limited
 */
function checkJoinRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = joinRateLimitMap.get(ip);

  // Periodic cleanup if map grows large
  if (joinRateLimitMap.size > 5000) {
    for (const [key, val] of joinRateLimitMap.entries()) {
      if (now > val.resetTime) joinRateLimitMap.delete(key);
    }
  }

  if (!record || now > record.resetTime) {
    joinRateLimitMap.set(ip, { count: 1, resetTime: now + 60_000 });
    return true;
  }

  if (record.count >= 10) {
    return false;
  }

  record.count += 1;
  return true;
}

function getOrCreateRoomState(roomCode: string): RoomState {
  if (!roomStatesMap.has(roomCode)) {
    roomStatesMap.set(roomCode, {
      roomCode,
      currentTrackA: { name: "No track selected", source: "upload" },
      currentTrackB: { name: "No track selected", source: "upload" },
      status: "stopped",
      playbackStartServerTime: 0,
      pausedElapsedMs: 0,
    });
  }
  return roomStatesMap.get(roomCode)!;
}

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  // Extract client IP address for rate limiting
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  ws.on("message", (rawMessage: Buffer | string) => {
    try {
      /**
       * Message size guard (64 KB).
       */
      const MAX_MESSAGE_BYTES = 64 * 1024;
      const messageStr = rawMessage.toString();
      if (messageStr.length > MAX_MESSAGE_BYTES) {
        ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
        return;
      }

      const data = JSON.parse(messageStr);

      switch (data.type) {
        case "join": {
          const { roomCode: rawCode, roomPassword: rawPassword } = data;
          if (!rawCode || typeof rawCode !== "string") return;

          // 1. Join Rate Limit Check (10 attempts per minute per IP)
          if (!checkJoinRateLimit(clientIp)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Too many join attempts. Please wait 1 minute before trying again.",
              })
            );
            return;
          }

          const MAX_ROOM_CODE_LENGTH = 64;
          if (rawCode.length > MAX_ROOM_CODE_LENGTH) {
            ws.send(JSON.stringify({ type: "error", message: "Room code too long (max 64 characters)" }));
            return;
          }

          const roomCode = rawCode.trim().toUpperCase();
          const submittedPassword = typeof rawPassword === "string" ? rawPassword.trim() : "";

          const currentClients = roomClientsMap.get(roomCode);
          const currentOccupancy = currentClients?.size || 0;

          // 2. Max Occupancy Check (Max 4 participants)
          const MAX_ROOM_OCCUPANCY = 4;
          if (currentOccupancy >= MAX_ROOM_OCCUPANCY) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Room "${roomCode}" is full (4/4 participants).`,
              })
            );
            return;
          }

          // 3. Room Password Check
          const roomExists = roomPasswordsMap.has(roomCode);
          if (roomExists) {
            const storedPassword = roomPasswordsMap.get(roomCode);
            if (storedPassword !== submittedPassword) {
              // Generic error message: does not reveal whether room exists or password was wrong
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Unable to join room: incorrect room code or password.",
                })
              );
              return;
            }
          } else {
            // First member joining creates the room and sets its password
            roomPasswordsMap.set(roomCode, submittedPassword);
          }

          // Handle leave previous room if client was already in one
          const prevRoom = socketRoomMap.get(ws);
          if (prevRoom && roomClientsMap.has(prevRoom)) {
            roomClientsMap.get(prevRoom)?.delete(ws);
          }

          if (!roomClientsMap.has(roomCode)) {
            roomClientsMap.set(roomCode, new Set());
          }
          roomClientsMap.get(roomCode)?.add(ws);
          socketRoomMap.set(ws, roomCode);

          const roomState = getOrCreateRoomState(roomCode);
          const clientCount = roomClientsMap.get(roomCode)?.size || 0;

          console.log(`[WS Server] Client joined "${roomCode}". Members: ${clientCount}/4`);

          // Broadcast room status & sync_state to room members
          broadcastToRoom(roomCode, {
            type: "sync_state",
            roomState,
            clientCount,
          });
          break;
        }

        case "ping": {
          const { clientTime } = data;
          ws.send(JSON.stringify({ type: "pong", clientTime, serverTime: Date.now() }));
          break;
        }

        case "change_tracks": {
          const { roomCode, trackA, trackB } = data;
          if (!roomCode) return;

          const roomState = getOrCreateRoomState(roomCode);
          roomState.currentTrackA = trackA;
          roomState.currentTrackB = trackB;
          roomState.status = "stopped";
          roomState.pausedElapsedMs = 0;
          roomState.playbackStartServerTime = 0;

          console.log(`[WS Server] Room "${roomCode}" tracks changed.`);

          broadcastToRoom(roomCode, {
            type: "sync_state",
            roomState,
            clientCount: roomClientsMap.get(roomCode)?.size || 1,
            action: "change_tracks",
          });
          break;
        }

        case "play": {
          const { roomCode, trackA, trackB } = data;
          if (!roomCode) return;

          const roomState = getOrCreateRoomState(roomCode);

          if (trackA) roomState.currentTrackA = trackA;
          if (trackB) roomState.currentTrackB = trackB;

          roomState.playbackStartServerTime = Date.now() + 2500;
          roomState.status = "playing";

          broadcastToRoom(roomCode, {
            type: "sync_state",
            roomState,
            clientCount: roomClientsMap.get(roomCode)?.size || 1,
            action: "play",
          });
          break;
        }

        case "pause": {
          const { roomCode } = data;
          if (!roomCode) return;

          const roomState = getOrCreateRoomState(roomCode);
          if (roomState.status === "playing") {
            const playingDuration = Math.max(0, Date.now() - roomState.playbackStartServerTime);
            roomState.pausedElapsedMs += playingDuration;
          }
          roomState.status = "paused";

          broadcastToRoom(roomCode, {
            type: "sync_state",
            roomState,
            clientCount: roomClientsMap.get(roomCode)?.size || 1,
            action: "pause",
          });
          break;
        }

        case "restart": {
          const { roomCode, trackA, trackB } = data;
          if (!roomCode) return;

          const roomState = getOrCreateRoomState(roomCode);
          if (trackA) roomState.currentTrackA = trackA;
          if (trackB) roomState.currentTrackB = trackB;

          roomState.pausedElapsedMs = 0;
          roomState.playbackStartServerTime = Date.now() + 2500;
          roomState.status = "playing";

          broadcastToRoom(roomCode, {
            type: "sync_state",
            roomState,
            clientCount: roomClientsMap.get(roomCode)?.size || 1,
            action: "restart",
          });
          break;
        }

        case "stop": {
          const { roomCode } = data;
          if (!roomCode) return;

          const roomState = getOrCreateRoomState(roomCode);
          roomState.status = "stopped";
          roomState.pausedElapsedMs = 0;
          roomState.playbackStartServerTime = 0;

          broadcastToRoom(roomCode, {
            type: "sync_state",
            roomState,
            clientCount: roomClientsMap.get(roomCode)?.size || 1,
            action: "stop",
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("[WS Server] Error:", err);
    }
  });

  ws.on("close", () => {
    const roomCode = socketRoomMap.get(ws);
    if (roomCode && roomClientsMap.has(roomCode)) {
      roomClientsMap.get(roomCode)?.delete(ws);
      const remaining = roomClientsMap.get(roomCode)?.size || 0;
      if (remaining === 0) {
        roomClientsMap.delete(roomCode);
        roomStatesMap.delete(roomCode);
        roomPasswordsMap.delete(roomCode); // Clean up password when room empties
      } else {
        const roomState = getOrCreateRoomState(roomCode);
        broadcastToRoom(roomCode, {
          type: "sync_state",
          roomState,
          clientCount: remaining,
        });
      }
    }
  });
});

function broadcastToRoom(roomCode: string, message: object): void {
  const clients = roomClientsMap.get(roomCode);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
