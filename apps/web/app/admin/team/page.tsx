import { Suspense } from "react";
import { TeamScreen } from "@/components/admin/TeamScreens";

/** /admin/team: A6 Team, roles and audit log. */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <TeamScreen />
    </Suspense>
  );
}
