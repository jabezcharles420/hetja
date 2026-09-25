import { Suspense } from "react";
import { FeedersScreen } from "@/components/admin/OpsScreens";

/** /admin/feeders: Feeders (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <FeedersScreen />
    </Suspense>
  );
}
