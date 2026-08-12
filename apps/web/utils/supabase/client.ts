/**
 * Browser-side Supabase client.
 *
 * Uses the publishable (anon) key, which ships inside the JS bundle and is
 * public by definition. Everything it can reach must therefore be protected
 * server-side: see ops/supabase/03_hardening.sql, which enables RLS on every
 * table with no anon policy and exposes reads only through the three
 * signature-gated RPCs.
 */
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => {
  if (!supabaseUrl || !supabaseKey) {
    // NEXT_PUBLIC_* are inlined at build time, so a missing value here means
    // the build ran without .env.production — fail loudly rather than issuing
    // requests to "undefined".
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set at build time",
    );
  }
  return createBrowserClient(supabaseUrl, supabaseKey);
};
