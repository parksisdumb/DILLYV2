import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";
import { Landing } from "./_landing/landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dilly — The Business Development OS for Commercial Construction",
  description:
    "Relationships win commercial work. Dilly makes sure you never drop one. Daily outreach, disciplined follow-up, and a portfolio-aware pipeline for commercial roofing and trade BD teams.",
  openGraph: {
    title: "Dilly — The Business Development OS for Commercial Construction",
    description:
      "Relationships win commercial work. Dilly makes sure you never drop one. Built for commercial roofing and trade BD teams.",
  },
};

export default async function RootPage() {
  const { userId } = await getServerAuthOrgState();
  if (userId) redirect("/app/today");
  return <Landing />;
}
