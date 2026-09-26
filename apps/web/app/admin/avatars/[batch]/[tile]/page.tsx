import { AvatarScreen } from "@/components/admin/AvatarScreens";

/** /admin/avatars/<batch>/<tile>: A4 One avatar, and where it shows. */
export default function Page({ params }: { params: { batch: string; tile: string } }): React.JSX.Element {
  return <AvatarScreen key={params.tile} batchId={decodeURIComponent(params.batch)} tileId={decodeURIComponent(params.tile)} />;
}
