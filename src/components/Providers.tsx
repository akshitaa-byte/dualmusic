"use client";

import { SessionProvider } from "next-auth/react";
import React from "react";

/**
 * Client-side Authentication Context Provider Wrapper.
 * 
 * WHAT: Wraps child components in NextAuth `<SessionProvider>`.
 * WHY: React context providers cannot be placed directly inside Server Components (like root `layout.tsx`).
 * Creating a dedicated client component allows wrapping the App Router tree with session context
 * enabling hooks like `useSession()` anywhere in the client UI.
 * 
 * @param {object} props - Component props containing React children.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
