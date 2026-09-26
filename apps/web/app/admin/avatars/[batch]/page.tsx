import { BatchScreen } from "@/components/admin/AvatarScreens";

/** /admin/avatars/<batch>: A3 Bulk avatar upload. */
export default function Page({ params }: { params: { batch: string } }): React.JSX.Element {
  return <BatchScreen key={params.batch} batchId={decodeURIComponent(params.batch)} />;
}
