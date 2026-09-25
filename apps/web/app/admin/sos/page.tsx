import { Suspense } from "react";
import { SosScreen } from "@/components/admin/OpsScreens";

/** /admin/sos (?tab, ?id): SOS cases (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <SosScreen />
    </Suspense>
  );
}
