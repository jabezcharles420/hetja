import type { Metadata } from "next";
import StoryScreen from "./StoryScreen";

export const metadata: Metadata = {
  title: "Write the story · Hetja",
  description: "Two or three lines that tell a stranger a dog is somebody's.",
  robots: { index: false, follow: false },
};

/** /me/dogs/<slug>/story: N16. Client-rendered: the session lives in localStorage. */
export default function DogStoryPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <StoryScreen slug={String(params.slug ?? "")} />;
}
