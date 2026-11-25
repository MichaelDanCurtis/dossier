import { describe, expect, it } from "vitest";
import { employerLink, parseAlert } from "./parse";

const listing = "https://www.linkedin.com/comm/jobs/view/123?trackingId=secret";
const board = "https://jobs.lever.co/example/engineering";
const anchor = (url: string, text: string) => `<a href="${url}">${text}</a>`;

describe("LinkedIn job alerts", () => {
  it("collapses repeated tracked links and keeps each employer link on its own card", () => {
    const first = anchor(listing, "Platform Engineer");
    const second = anchor(listing.replace("123", "456"), "Design Lead");
    const roles = parseAlert(`<table><tr><td>${first}<div>Example</div>${first}${anchor(board + "/apply?ref=email", "Apply")}</td></tr><tr><td>${second}</td></tr></table>`, "");
    expect(roles).toMatchObject([{ title: "Platform Engineer", employerUrl: board, linkedinUrl: "https://www.linkedin.com/jobs/view/123/" }, { title: "Design Lead", employerUrl: "" }]);
  });
  it("refuses ambiguous employer evidence and unrelated or misleading domains", () => {
    const html = [anchor(listing, "Engineer"), anchor(board, "Apply"), anchor(board + "2", "View")].join("");
    expect(parseAlert("<div>" + html + "</div>", "")[0].employerUrl).toBe("");
    expect(parseAlert(anchor(listing.replace("linkedin.com", "linkedin.com.example.net"), "Engineer"), "")).toEqual([]);
    expect(employerLink("https://jobs.lever.co@other.example/evil/role")).toBe("");
  });
  it("records a plain-text lead without inventing an employer or fetching a description", () => {
    expect(parseAlert("", "Engineer\n" + listing)).toEqual([{ linkedinUrl: "https://www.linkedin.com/jobs/view/123/", title: "Engineer", employerUrl: "", company: "" }]);
  });
});
