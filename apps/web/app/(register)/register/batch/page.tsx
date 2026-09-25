import type { Metadata } from "next";
import BatchClient from "./BatchClient";

export const metadata: Metadata = {
  title: "Batch sheet · Hetja",
  description: "Tags for up to eight of your dogs on one A4 page, two each.",
};

export default function BatchPage(): React.JSX.Element {
  return <BatchClient />;
}
