/**
 * Server-side Supabase client for Server Components, Route Handlers and Server
 * Actions.
 *
 * Next 14 note: `cookies()` is synchronous here and returns
 * ReadonlyRequestCookies. It only became a Promise (requiring `await`) in Next
 * 15, so this takes the store directly rather than an awaited value.
 *
 * Usage in a Server Component:
 *
 *   import { cookies } from "next/headers";
 *   import { createClient } from "@/utils/supabase/server";
 *
 *   const supabase = createClient(cookies());
 */
import { createServerClient } from "@supabase/ssr";
import type { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type CookieStore = ReturnType<typeof cookies>;

export const createClient = (cookieStore: CookieStore) => {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set at build time",
    );
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            // `set` exists at runtime but is not on the readonly type Next
            // exposes to Server Components.
            (cookieStore as unknown as {
              set: (n: string, v: string, o?: Record<string, unknown>) => void;
            }).set(name, value, options as Record<string, unknown>);
          });
        } catch {
          // Server Components cannot write cookies. Safe to swallow only
          // because middleware refreshes the session — see
          // utils/supabase/middleware.ts.
        }
      },
    },
  });
};
