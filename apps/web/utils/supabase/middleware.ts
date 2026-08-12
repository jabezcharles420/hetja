/**
 * Session-refresh middleware helper.
 *
 * Two things worth knowing before wiring this up:
 *
 * 1. Hetja does not use Supabase Auth. Feeder login is phone OTP exchanged for
 *    the API's own JWTs, held in localStorage (apps/web/lib/api.ts). Until that
 *    moves to Supabase Auth, this helper refreshes nothing — it is scaffolding
 *    for when/if it does. Adding a middleware.ts that calls it costs a hop on
 *    every request for no benefit today.
 *
 * 2. The version of this in the Supabase docs snippet is subtly broken: it
 *    creates the client and returns the response without ever awaiting
 *    `supabase.auth.getUser()`. The cookie-refresh happens as a side effect of
 *    that call, so without it no session is ever refreshed. That call is why
 *    this function is async.
 *
 * To activate, add apps/web/middleware.ts:
 *
 *   import type { NextRequest } from "next/server";
 *   import { updateSession } from "@/utils/supabase/middleware";
 *
 *   export async function middleware(request: NextRequest) {
 *     return await updateSession(request);
 *   }
 *
 *   export const config = {
 *     matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webmanifest)$).*)"],
 *   };
 */
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const updateSession = async (request: NextRequest): Promise<NextResponse> => {
  let supabaseResponse = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // This call is the entire point of the middleware: it revalidates the token
  // and triggers setAll() above with refreshed cookies. Do not remove it.
  await supabase.auth.getUser();

  return supabaseResponse;
};
