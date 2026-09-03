import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

/**
 * NextAuth.js Configuration Options.
 * 
 * WHAT: Configures authentication providers (Google OAuth), Prisma ORM adapter for user persistence,
 * session strategy, and custom session callbacks to expose `user.id`.
 * WHY:
 * 1. PrismaAdapter automatically creates/updates `User`, `Account`, and `Session` records in PostgreSQL.
 * 2. Standard NextAuth session objects default to returning `name`, `email`, and `image`.
 *    Adding a custom `session` callback guarantees `session.user.id` is available across the entire app
 *    for associating split-audio pairings with specific users.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as unknown as NextAuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  session: {
    strategy: "database",
  },
  callbacks: {
    /**
     * Attaches user.id from the database user record to the active NextAuth session object.
     * 
     * WHAT: Mutates the returned `session.user` object to include `user.id`.
     * WHY: Server components and API routes require the database primary key `user.id` to query user-owned pairings.
     */
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
