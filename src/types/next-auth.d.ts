import NextAuth from "next-auth";

declare module "next-auth" {
  /**
   * Extends the built-in Session interface to include user.id.
   * 
   * WHY: By default, NextAuth's `Session` type only includes `name`, `email`, and `image`.
   * Extending the module declaration provides full TypeScript type safety when accessing `session.user.id`.
   */
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
