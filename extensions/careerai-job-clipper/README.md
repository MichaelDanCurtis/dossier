# CareerAI job collection — Chrome extension 0.2.1

Version 0.2.0 adds a user-started collection page for up to ten chosen search results. It reads full job descriptions sequentially in the original LinkedIn tab, opens each new page at least eight seconds after the previous one, and saves the jobs for career-aware AI review. It supports LinkedIn's newer and legacy layouts. Browser permissions and extension identity are unchanged.

Version 0.2.1 fixes individual job pages where the role is plain text and employment labels such as On-site link to the same job URL. It reads the nearby job header and waits if the actual title is missing.

To update an existing unpacked installation, replace the files in its existing folder with the new download, then press Reload for CareerAI at `chrome://extensions`. Keep the same folder and do not Remove the extension; reloading preserves its pairing.

1. Open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select this folder (the one containing manifest.json).
2. Pin CareerAI in Chrome’s extensions menu.
3. In CareerAI, open LinkedIn → Chrome extension. Generate a one-time pairing code, then paste it into the extension and press Connect CareerAI.
4. Open a LinkedIn job search in Chrome, open CareerAI from the toolbar and choose **Choose jobs from this search**.
5. Choose up to ten rendered results, approve reading/saving those descriptions, then start collection. Keep the collection page and LinkedIn tab open. Stop before using the LinkedIn tab yourself. Closing the collection page stops its work; it never resumes automatically.
6. Open CareerAI review from the results page. Start its bounded AI career review to get summaries, evidence, tradeoffs and questions. Choose a role to prepare its resume; you review and submit applications yourself.

Single-job capture remains available: Capture current job → correct details → approve → save. No background collection is scheduled. Only results already rendered by the search are offered, with no automatic scrolling or pagination. Sign-in, verification, lost tab access or three unreadable descriptions pause collection. Failed or ambiguous saves are not retried automatically. The progress screen links to CareerAI so you can check uncertain saves.

LinkedIn login/cookies stay in Chrome. The extension does not request cookies, webRequest, debugger, browsing history, all-sites or background content-script permissions. It reads job-specific DOM using the temporary active-tab access granted by your toolbar click. Collection navigates that same tab to selected job URLs; it never submits forms, applies, posts, sends messages, reads your inbox or captures form values. There is no background worker, scheduled collection or telemetry. Chrome documents active-tab access across navigation within the same origin: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab .

Only the job details you explicitly choose to collect are sent to careerai.thecurtis.cloud over HTTPS, using an import-only token stored in this extension’s local Chrome storage (not Chrome Sync). Pairing codes expire in five minutes and work once. Connections expire after 90 days and can be revoked from CareerAI. A password reset or disabled CareerAI account invalidates existing connections. Disconnect in the popup revokes its credential; removing the extension alone does not revoke a server-side credential, so revoke it in CareerAI as well.

A re-save updates the existing canonical LinkedIn opportunity; it does not create or submit an application. Network errors are never retried automatically. Check saved jobs in CareerAI before retrying an uncertain save. Expand LinkedIn’s description first if necessary; incomplete captures must be corrected before saving.

This is a private unpacked extension, not a Chrome Web Store publication or a LinkedIn-approved integration. LinkedIn’s restrictions on copying/scraping and extensions still apply: https://www.linkedin.com/help/linkedin/answer/a1341387 . This version provides user-initiated import, not unattended collection or a way around verification.

Licensed AGPL-3.0-only; see LICENSE. The source is included in this folder and in CareerAI’s deployment source download.
