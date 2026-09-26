import { Suspense } from "react";
import { AddTeamScreen } from "@/components/admin/TeamScreens";

/** /admin/team/add: Add someone to the team (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <AddTeamScreen />
    </Suspense>
  );
}
