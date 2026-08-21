/**
 * Path-parameter validation.
 *
 * A `:id` param interpolated straight into a query against a `uuid` column
 * turned any non-UUID value into PostgreSQL error 22P02 ("invalid input
 * syntax for type uuid"), which the central error handler renders as a 500 —
 * so a caller who typo'd a URL got "internal server error", and the 500 log
 * noise quoted attacker-controlled input back at us. The message leak was
 * closed in server.ts; this closes the status half, because a malformed
 * parameter is a client error and must be answered with a 400 at the route,
 * not depend on a driver error code surfacing from the query.
 */
import { z } from "zod";

const UuidSchema = z.string().uuid();

/**
 * Returns the value if it is a syntactically valid UUID, otherwise null.
 * Callers answer null with their own 400 so each route keeps its own error
 * code (INVALID_CASE_ID, INVALID_STORY_ID, …) in the shared envelope shape.
 */
export function parseUuidParam(value: string): string | null {
  const parsed = UuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
