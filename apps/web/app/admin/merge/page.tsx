"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MergeScreen } from "@/components/admin/DogScreens";

function Merge(): React.JSX.Element {
  const p = useSearchParams();
  const a = p?.get("a") ?? "";
  const b = p?.get("b") ?? "";
  if (!a || !b) return <p style={{ padding: 48 }}>Open a possible duplicate from Reports or a dog to compare two dogs.</p>;
  return <MergeScreen key={`${a}:${b}`} a={a} b={b} reportId={p?.get("report") ?? null} />;
}

/** /admin/merge?a=&b=&report=: A5 Merge duplicate dogs. */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <Merge />
    </Suspense>
  );
}
