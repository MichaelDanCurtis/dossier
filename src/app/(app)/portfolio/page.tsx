import type { Metadata } from "next";
import { loadProfile } from "@/lib/profile-data";
import { PortfolioWorkspace } from "./workspace";

export const metadata: Metadata = { title: "Personal website" };
export default async function PortfolioPage() { return <PortfolioWorkspace profile={await loadProfile()} />; }
