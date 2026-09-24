import type { Metadata } from "next";
import FeedScreen from "./FeedScreen";

export const metadata: Metadata = {
  title: "Log a feed · Hetja",
  description: "Log that you fed a dog, so its other feeders know it has eaten.",
};

export default function FeedPage(): React.JSX.Element {
  return <FeedScreen />;
}
