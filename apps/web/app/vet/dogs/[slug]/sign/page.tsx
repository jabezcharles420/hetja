import type { Metadata } from "next";
import SignRecordScreen from "@/components/vet/SignRecordScreen";

export const metadata: Metadata = {
  title: "Sign a record · Hetja",
  robots: { index: false, follow: false },
};

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
}

/** /vet/dogs/<slug>/sign?kind=&request=&note=&drive=: V3 (design v7); `drive` from an NGO drive (N5). */
export default function SignPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}): React.JSX.Element {
  const slug = String(params.slug ?? "");
  const request = one(searchParams.request);
  const note = one(searchParams.note);
  const drive = one(searchParams.drive);
  return (
    <SignRecordScreen
      key={`${slug}:${request ?? ""}:${note ?? ""}`}
      slug={slug}
      kind={one(searchParams.kind)}
      requestId={request}
      noteId={note}
      driveId={drive}
    />
  );
}
