# CareerAI job clipper — Chrome extension 0.1.0

1. Open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select this folder (the one containing manifest.json).
2. Pin CareerAI in Chrome’s extensions menu.
3. In CareerAI, open LinkedIn → Chrome extension. Generate a one-time pairing code, then paste it into the extension and press Connect CareerAI.
4. Browse LinkedIn normally. Open a job or select one in job search, open the extension, and press Capture current job.
5. Review/correct the captured role, company, location and description. Approve the details, then press Save job to CareerAI.
6. Score and prepare documents in CareerAI. You submit applications yourself on LinkedIn.

LinkedIn login/cookies stay in Chrome. The extension does not request cookies, webRequest, debugger, browsing history, all-sites or background content-script permissions. It reads only job-specific DOM elements in the active LinkedIn tab after Capture current job. It does not call LinkedIn APIs or navigate, click, submit, post or send messages there. No inbox, contact/profile data or form field values are captured. There is no background worker or telemetry.

Only the job details you review are sent to careerai.thecurtis.cloud over HTTPS, using an import-only token stored in this extension’s local Chrome storage (not Chrome Sync). Pairing codes expire in five minutes and work once. Connections expire after 90 days and can be revoked from CareerAI. A password reset or disabled CareerAI account invalidates existing connections. Disconnect in the popup revokes its credential; removing the extension alone does not revoke a server-side credential, so revoke it in CareerAI as well.

A re-save updates the existing canonical LinkedIn opportunity; it does not create or submit an application. Network errors are never retried automatically. Check saved jobs in CareerAI before retrying an uncertain save. Expand LinkedIn’s description first if necessary; incomplete captures must be corrected before saving.

This is a private unpacked extension, not a Chrome Web Store publication or a LinkedIn-approved integration. LinkedIn’s restrictions on copying/scraping and extensions still apply: https://www.linkedin.com/help/linkedin/answer/a1341387 . This version provides user-initiated import, not unattended collection or a way around verification.

Licensed AGPL-3.0-only; see LICENSE. The source is included in this folder and in CareerAI’s deployment source download.
