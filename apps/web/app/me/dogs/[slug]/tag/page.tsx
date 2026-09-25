import type { Metadata } from "next";
import TagScreen from "./TagScreen";

export const metadata: Metadata = {
  title: "Tag · Hetja",
  description: "A tag problem reported on one of your dogs, and its tag history.",
  robots: { index: false, follow: false },
};

/** /me/dogs/<slug>/tag: F6. Client-rendered: the session lives in localStorage. */
export default function DogTagPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <TagScreen slug={String(params.slug ?? "")} />;
}
