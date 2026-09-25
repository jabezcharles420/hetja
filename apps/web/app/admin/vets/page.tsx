import { Suspense } from "react";
import { VetsScreen } from "@/components/admin/VetsScreen";

/** /admin/vets (?tab, ?id): A2. */
export default function AdminVetsPage(): React.JSX.Element {
  return (
    <Suspense>
      <VetsScreen />
    </Suspense>
  );
}
