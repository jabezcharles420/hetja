import { Suspense } from "react";
import { AuditScreen } from "@/components/admin/TeamScreens";

/** /admin/audit: the whole audit log (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <AuditScreen />
    </Suspense>
  );
}
