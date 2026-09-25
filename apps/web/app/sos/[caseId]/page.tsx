import type { Metadata } from "next";
import SosCaseScreen from "./SosCaseScreen";

export const metadata: Metadata = {
  title: "SOS case · Hetja",
  description: "A dog near you needs help. See the case and say if you can go.",
  robots: { index: false, follow: false },
};

/**
 * /sos/<caseId>: where an SOS push lands (apps/worker sends url /sos/<caseId>,
 * public/sw.js opens it on click). Client-rendered: the session lives in
 * localStorage, so the signed-out redirect happens in the browser.
 */
export default function SosCasePage({ params }: { params: { caseId: string } }): React.JSX.Element {
  return <SosCaseScreen caseId={String(params.caseId ?? "")} />;
}
