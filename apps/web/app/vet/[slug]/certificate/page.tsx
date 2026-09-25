import type { Metadata } from "next";
import CertificateScreen from "@/components/vet/CertificateScreen";

export const metadata: Metadata = {
  title: "Vaccination certificate · Hetja",
  description: "A dog's vet-signed records as a PDF, for rescues and adoptions.",
  robots: { index: false, follow: false },
};

/** /vet/<slug>/certificate: the certificate page the collar page links to (design v7 V4). */
export default function CertificatePage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <CertificateScreen slug={String(params.slug ?? "")} />;
}
