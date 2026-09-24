import type { Metadata } from "next";
import { MapScreen } from "@/components/map/MapScreen";

export const metadata: Metadata = {
  title: "Map of Mumbai · Hetja",
  description:
    "Which wards have a dog that needs help, which are waiting for dinner, and the vets and NGOs nearby. Dogs are shown by ward, never by street.",
};

export default function MapPage(): React.JSX.Element {
  return <MapScreen />;
}
