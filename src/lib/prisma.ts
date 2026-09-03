import { PrismaClient } from "@prisma/client";

/**
 * Singleton instance of PrismaClient.
 * 
 * WHAT: Instantiates or reuses a single `PrismaClient` connection instance across the application lifecycle.
 * WHY: In Next.js development mode, hot-reloading re-executes module scripts on every code edit.
 * Creating `new PrismaClient()` on every module execution leads to "too many clients already created"
 * database connection pool exhaustion. Storing the instance on `globalThis` preserves the connection pool.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
