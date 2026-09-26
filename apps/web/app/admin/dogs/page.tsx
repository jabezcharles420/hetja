import { Suspense } from "react";
import { DogsScreen } from "@/components/admin/DogScreens";

/** /admin/dogs: Dogs (designed). */
export default function Page(): React.JSX.Element {
  return (
    <Suspense>
      <DogsScreen />
    </Suspense>
  );
}
