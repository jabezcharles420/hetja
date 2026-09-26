import { FeederScreen } from "@/components/admin/OpsScreens";

/** /admin/feeders/<id>: one feeder and the moderation tools (designed). */
export default function Page({ params }: { params: { id: string } }): React.JSX.Element {
  return <FeederScreen key={params.id} id={decodeURIComponent(params.id)} />;
}
