# CareerAI LinkedIn workspace — Chrome extension 0.3.1

CareerAI now opens inside LinkedIn: a top-right button opens a modal with Jobs, Feed, Messages and Write tabs. No separate collection progress page or separate browser sign-in is needed. Reads use a background LinkedIn tab in the same Chrome profile; cookie values are never accessed or exported.

## Install or update

1. Unzip the download. For an existing installation, replace files in its existing folder and press Reload at `chrome://extensions`. Keep the existing installation to preserve its identity.
2. For a new installation, enable Developer mode, choose Load unpacked and select the folder containing manifest.json. Pin CareerAI in Chrome’s extensions menu.
3. Open LinkedIn in your normal signed-in Chrome. Click the CareerAI toolbar icon and approve LinkedIn site access once. It opens the workspace modal directly, without a popup or controller page. If you are outside LinkedIn, it selects a LinkedIn tab in this window or opens LinkedIn itself.
4. For a new or jobs-only connection, create a **workspace pairing code** in CareerAI → LinkedIn → Chrome extension, then paste it into the modal. Existing workspace connections are kept.
5. Thereafter, use the CareerAI button near LinkedIn’s top right, just below its navigation bar. Connection settings, pairing and disconnect are inside the modal too. Close with Escape, the close button or the backdrop. The button stays available as you navigate LinkedIn.

## What it does

- Jobs: enter a role/location or collect the current search. Choose a limit of 10, 25 or 50 jobs. Reads full descriptions sequentially, across at most five search pages. Search scrolling and page navigation are spaced at least eight seconds apart. It stops at available rendered results or its budget and says why. If AI is configured, career-fit reviews use your saved experience. Prepare a résumé only for the roles you choose.
- Feed: collect up to 20 rendered excerpts, with up to three scrolls. Get career-relevant summaries and next steps. Missing source permalinks stay missing; excerpts do not imply that the full post or entire feed was read.
- Messages: capture up to 20 inbox previews, select a specific conversation, or read the thread already open in your main LinkedIn tab. Opening LinkedIn’s inbox or a selected thread may mark a message read. Preview-only captures cannot generate reply drafts. Copy a reply draft and send it yourself.
- Write: brainstorm with your existing Publicist conversation, using saved public expertise and up to six captured feed excerpts. Private messages are excluded from public writing context. Copy text to LinkedIn yourself. Native CareerAI still provides Publicist model/effort settings, images and article tools.

Closing the modal does not stop its run. Stop closes the extension’s read tab and cancels the run’s AI review; confirmed captures remain saved. Keep Chrome running. Unexpected sign-in/security checks pause reading. No challenge solving or browser disguise is used. A suspended worker resumes its saved checkpoint on the next browser/panel event. A save interrupted in flight is paused as uncertain and never replayed automatically; check CareerAI before retrying. AI tasks also have server-side idempotency claims.

## Access and privacy

Required permissions: activeTab, scripting, storage, plus CareerAI’s fixed HTTPS host. Optional site access is limited to `https://www.linkedin.com/*` and enables the injected button and user-started background reading. The script does not collect anything merely by showing its button. No cookies, debugger, webRequest, browsing-history or all-sites permission. Tokens are stored only in trusted extension storage, never Chrome Sync or the page; the content script receives no credential. The modal uses a closed shadow root and renders captured/AI text as text, never executable markup.

Captured content is uploaded to your paired private CareerAI account and may be sent to its configured AI provider for reviews/drafts. Workspace grants can read captured summaries, the Publicist conversation and their own AI task results, start paid reviews, and prepare drafts with saved career context. They cannot retrieve API keys or send applications, posts, reactions or messages. Existing job-only grants remain job-only. Codes expire after five minutes and work once; grants expire after 90 days and are origin/account/revision bound. Revoke access in CareerAI or disconnect in the modal’s Connection settings; removing the extension alone does not revoke a server-side token.

This is a private unpacked extension, not a Chrome Web Store publication or LinkedIn-approved integration. LinkedIn’s restrictions still apply. There is no unattended schedule or security-check bypass. The former standalone controller and toolbar popup are not included in the package. The local Python/MCP browser experiment is not part of this release; this extension uses the normal Chrome session and CareerAI’s authenticated workspace endpoint.

Licensed AGPL-3.0-only; see LICENSE. All extension source ships in the ZIP and CareerAI’s deployment source download.
