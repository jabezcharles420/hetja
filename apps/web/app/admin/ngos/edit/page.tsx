"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { NgoFormScreen } from "@/components/admin/NgosScreen";

function Edit(): React.JSX.Element {
  return <NgoFormScreen editId={useSearchParams()?.get("id") ?? null} />;
}

/** /admin/ngos/edit?id=: Edit details (designed, from A7). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <Edit />
    </Suspense>
  );
}
