import type { Metadata } from "next";
import { companyPostings, listCompanyBoards } from "@/lib/company-boards/data";
import { postingKey } from "@/lib/job-search/search";
import { postingStates } from "@/lib/postings";
import { CompanyBoards } from "./workspace";

export const metadata: Metadata = { title: "Company boards" };
export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const params = await searchParams;
  const keywords = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const remoteOnly = params.remote === "1";
  const boardId = typeof params.board === "string" && params.board ? params.board : undefined;
  const [boards, postings] = await Promise.all([listCompanyBoards(), companyPostings({ boardId, keywords, remoteOnly })]);
  const states = await postingStates(postings);
  return <CompanyBoards key={`${boardId}:${keywords}:${remoteOnly}`} boards={boards} postings={postings.map((posting) => ({ ...posting, state: states.get(postingKey(posting))! }))} keywords={keywords} remoteOnly={remoteOnly} boardId={boardId} today={new Date().toISOString()} />;
}
