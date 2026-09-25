import { DogScreen } from "@/components/admin/DogScreens";

/** /admin/dogs/<slug>: one dog (designed). */
export default function Page({ params }: { params: { slug: string } }): React.JSX.Element {
  return <DogScreen key={params.slug} slug={decodeURIComponent(params.slug)} />;
}
