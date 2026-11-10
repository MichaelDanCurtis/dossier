import type { Metadata } from "next";
import { listPostings } from "@/lib/postings";
import { LinkedinWorkspace } from "./workspace";

export const metadata: Metadata = { title: "LinkedIn opportunities" };
export default async function LinkedinPage() {
  const postings = (await listPostings("saved")).filter((posting) => posting.source === "LINKEDIN");
  return <LinkedinWorkspace postings={postings} today={new Date().toISOString()} />;
}
