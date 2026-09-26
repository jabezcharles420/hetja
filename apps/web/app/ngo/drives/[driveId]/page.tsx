import type { Metadata } from "next";
import DriveScreen from "@/components/ngo/DriveScreen";

export const metadata: Metadata = {
  title: "Drive · Hetja",
  description: "A collar and sterilisation drive.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page({ params }: { params: { driveId: string } }): React.JSX.Element {
  return <DriveScreen driveId={String(params.driveId ?? "")} />;
}
