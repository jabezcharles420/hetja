import type { Metadata } from "next";
import MyDogsScreen from "./MyDogsScreen";

export const metadata: Metadata = {
  title: "My dogs · Hetja",
  description: "The dogs you feed, and what needs doing today.",
  robots: { index: false, follow: false },
};

/** /me/dogs: N4 My dogs. Client-rendered: the session lives in localStorage. */
export default function MyDogsPage(): React.JSX.Element {
  return <MyDogsScreen />;
}
