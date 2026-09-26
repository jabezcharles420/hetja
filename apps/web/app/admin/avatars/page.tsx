import { Suspense } from "react";
import { AvatarsScreen } from "@/components/admin/AvatarScreens";

/** /admin/avatars: the avatar batches (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <AvatarsScreen />
    </Suspense>
  );
}
