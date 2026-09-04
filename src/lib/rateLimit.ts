import { NextResponse } from "next/server";

/**
 * In-Memory Fixed Window Rate Limiter
 * 
 * WHAT IT DOES:
 * Tracks request counts per IP address within a rolling fixed time window (e.g. 1 minute).
 * If an IP exceeds the maximum allowed requests within that window, subsequent requests are rejected
 * with an HTTP 429 (Too Many Requests) response until the window resets.
 * 
 * WHY IT MATTERS (ARCHITECTURAL REASONING):
 * Prevents Denial-of-Service (DoS) attacks, brute-force requests, and third-party API quota exhaustion
 * (Jamendo and Spotify endpoints). For single-instance deployments, an in-memory Map is fast and requires zero
 * external infrastructure (like Redis).
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const ipStore = new Map<string, RateLimitRecord>();

/**
 * Extracts the real client IP address from the request headers.
 * Prefers standard reverse proxy headers (e.g., Vercel / Cloudflare `x-forwarded-for`).
 * 
 * @param req - Next.js Request object
 * @returns The client IP string or a fallback identifier
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can contain a comma-separated list of proxies; the first one is the client IP.
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

/**
 * Evaluates whether an IP address has exceeded its rate limit.
 * 
 * @param ip - Client IP address
 * @param maxRequests - Maximum requests permitted in the timeframe
 * @param windowMs - Time window size in milliseconds (e.g. 60,000 ms for 1 minute)
 * @returns Object with boolean `allowed` and `retryAfterMs` timestamp
 */
export function checkRateLimit(
  ip: string,
  maxRequests: number = 30,
  windowMs: number = 60_000
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const record = ipStore.get(ip);

  // Periodic cleanup of expired records if map gets large (> 10,000 entries)
  if (ipStore.size > 10_000) {
    for (const [key, val] of ipStore.entries()) {
      if (now > val.resetTime) {
        ipStore.delete(key);
      }
    }
  }

  if (!record || now > record.resetTime) {
    // New or expired window
    ipStore.set(ip, {
      count: 1,
      resetTime: now + windowMs,
    });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterMs: record.resetTime - now,
    };
  }

  record.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Helper to construct a standard HTTP 429 Rate Limit Exceeded response.
 * 
 * @param retryAfterMs - Milliseconds remaining until rate limit window resets
 * @returns NextResponse with status 429 and Retry-After header
 */
export function rateLimitExceededResponse(retryAfterMs: number): NextResponse {
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}
