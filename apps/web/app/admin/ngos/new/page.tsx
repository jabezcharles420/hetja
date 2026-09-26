import { Suspense } from "react";
import { NgoFormScreen } from "@/components/admin/NgosScreen";

/** /admin/ngos/new: Add an NGO (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <NgoFormScreen />
    </Suspense>
  );
}
