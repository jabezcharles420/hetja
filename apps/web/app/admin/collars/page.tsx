import { Suspense } from "react";
import { CollarsScreen } from "@/components/admin/OpsScreens";

/** /admin/collars (?tab, ?id): Collars (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <CollarsScreen />
    </Suspense>
  );
}
