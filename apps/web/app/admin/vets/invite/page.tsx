import { Suspense } from "react";
import { InviteVetScreen } from "@/components/admin/TeamScreens";

/** /admin/vets/invite: Invite a vet (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <InviteVetScreen />
    </Suspense>
  );
}
