import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAlertBody, listAlertPage } from "./gmail";

const fetchMail = vi.hoisted(() => vi.fn());
vi.mock("./account", () => ({ googleFetch: fetchMail }));
vi.mock("@/lib/env", () => ({ env: {} }));
beforeEach(() => fetchMail.mockReset());

const message = (from: string, labels: string[]) => ({
  id: "a1", threadId: "t1", internalDate: "1790000000000", labelIds: labels,
  payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }], parts: [
    { mimeType: "text/plain", body: { data: Buffer.from("Fixture role").toString("base64url") } },
    { mimeType: "text/html", body: { data: Buffer.from("<b>Fixture role</b>").toString("base64url") } },
  ] },
});

describe("Gmail job alert intake", () => {
  it("confines paginated searches to the selected label, senders and time window", async () => {
    fetchMail.mockResolvedValue({ messages: [] });
    await listAlertPage("Label_123", 200, 300, "next-page");
    const [scope, url] = fetchMail.mock.calls[0] as [string, URL];
    expect(scope).toBe("read");
    expect(url.searchParams.get("labelIds")).toBe("Label_123");
    expect(url.searchParams.get("q")).toBe("{from:jobalerts-noreply@linkedin.com from:jobs-noreply@linkedin.com} after:200 before:300");
    expect(url.searchParams.get("pageToken")).toBe("next-page");
  });

  it("rechecks both the sender address and label when fetching a message", async () => {
    fetchMail.mockResolvedValueOnce(message("LinkedIn Jobs <jobalerts-noreply@linkedin.com>", ["INBOX"]));
    expect(await getAlertBody("a1", "INBOX")).toMatchObject({ plain: "Fixture role", html: "<b>Fixture role</b>" });
    fetchMail.mockResolvedValueOnce(message("jobs-noreply@linkedin.com", ["OTHER"]));
    expect(await getAlertBody("a1", "INBOX")).toBeNull();
    fetchMail.mockResolvedValueOnce(message("jobs-noreply@linkedin.com <reader@other.example>", ["INBOX"]));
    expect(await getAlertBody("a1", "INBOX")).toBeNull();
  });
});
