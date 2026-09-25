import { Suspense } from "react";
import { SettingsScreen } from "@/components/admin/TeamScreens";

/** /admin/settings: the rules, read-only (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}
