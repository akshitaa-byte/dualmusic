import crypto from "crypto";

/**
 * Generates a short, URL-safe random share slug string.
 * 
 * WHAT: Generates 6 random bytes converted to a 12-character hexadecimal string.
 * WHY: Provides human-readable, URL-friendly unique slugs (e.g., `a3f89c1b7e92`) for shareable URLs
 * (`/share/[slug]`) without requiring third-party library dependencies.
 * 
 * @returns {string} A 12-character URL-safe random string.
 */
export function generateShareSlug(): string {
  return crypto.randomBytes(6).toString("hex");
}
