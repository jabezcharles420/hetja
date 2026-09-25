import { Suspense } from "react";
import { NgosScreen } from "@/components/admin/NgosScreen";

/** /admin/ngos (?tab, ?id): A7. */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <NgosScreen />
    </Suspense>
  );
}
