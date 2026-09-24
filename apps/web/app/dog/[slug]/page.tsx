import { redirect } from "next/navigation";

/**
 * The old in-app dog page. The profile now lives at /d/<slug>, a separate
 * fast, server-rendered app (apps/scan behind Caddy), so any old link or
 * printed collar that still says /dog/ is sent there, signature and all.
 */
export default function DogRedirect({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { s?: string | string[] };
}): never {
  const slug = encodeURIComponent(String(params.slug ?? "").toLowerCase());
  const raw = Array.isArray(searchParams.s) ? searchParams.s[0] : searchParams.s;
  redirect(`/d/${slug}${raw ? `?s=${encodeURIComponent(raw)}` : ""}`);
}
