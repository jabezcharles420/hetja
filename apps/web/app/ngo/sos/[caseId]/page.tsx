import type { Metadata } from "next";
import DispatchScreen from "@/components/ngo/DispatchScreen";

export const metadata: Metadata = {
  title: "Send someone · Hetja",
  description: "Pick who from your team goes to this SOS.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page({ params }: { params: { caseId: string } }): React.JSX.Element {
  return <DispatchScreen caseId={String(params.caseId ?? "")} />;
}
