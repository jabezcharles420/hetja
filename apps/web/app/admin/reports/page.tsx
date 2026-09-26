import { Suspense } from "react";
import { ReportsScreen } from "@/components/admin/OpsScreens";

/** /admin/reports (?tab, ?id, ?status): Reports (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <ReportsScreen />
    </Suspense>
  );
}
