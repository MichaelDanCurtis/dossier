# CareerAI writing and agent workspaces

Private-fork trial. Profile now has reviewed AI wording help for summary,
experience/project achievements and education notes. Select text and right-click
to rewrite a passage. Suggestions do not replace text until accepted; stale
selections and oversized replacements are rejected.

Base Resume → Content → Open document editor uses Tiptap, also used in Folio's
desktop editor. It supports paragraphs, achievement bullets, bold/italic,
undo/redo and selected-text AI. Resume variants, explicit Save/Cancel, live
preview, version restore and existing PDF rendering remain authoritative.
This is a structured resume editor, not an arbitrary Word document importer.
Job titles, dates, companies and credentials remain in Profile.
Emphasis is compatible with existing resume markup at whole-word boundaries.

Agents has Job, Career and Publicist workspaces:

- Job Agent can score saved LinkedIn opportunities and explicitly review
  imported recruiter messages. A message can be attached to an existing
  application. No LinkedIn message is sent.
- Career Agent stores status, employer, watched role and private annual pay.
  It compares individual cached/saved postings in the same explicit currency
  and annual cadence, never inventing a market median or currency conversion.
  Company boards keep their existing opt-in schedules. Career AI reviews
  receive published ranges and relative comparisons, never exact private pay.
- Publicist refreshes selected public publisher RSS feeds manually, or daily
  if enabled. Generation uses only a user's brief and selected non-message
  excerpts. Drafts are editable and downloadable. Monitoring never drafts or
  publishes automatically. The initial feeds are AWS News, CNCF and Microsoft
  Security; publisher selection can expand after this trial.

## LinkedIn capability boundary

Official references:
[Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin),
[OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2),
[access guide](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access),
[Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).

This trial implements an optional personal developer-app OAuth connection for
OpenID identity and w_member_social text posting. The callback is
/api/linkedin/callback on the installation's canonical origin. A reviewed post
is sent using the documented self-service UGC endpoint. Access depends on the
developer app's products, grants and LinkedIn policy.

Personal feed, inbox, job discovery and Easy Apply are not verified self-service
grants. Posts, source excerpts, jobs and messages can be imported by the user;
an imported source URL alone does not mean the source has been fetched.
The LinkedIn MCP implementations investigated either wrap the same official
posting/identity API or rely on a logged-in browser session. No browser-cookie
scraper is installed or represented as an official API connection.

Credentials and tokens are encrypted per private workspace, excluded from
portable exports and preserved when importing data. OAuth state is short-lived,
single-use and bound to the browser and workspace. Disconnect clears the local
publishing token. Delete everything clears workspace state and credentials.
LinkedIn's own authorization can also be revoked in LinkedIn settings.

Publishing requires review of the exact saved text and connected member. Changes
invalidate approval. Durable reservation prevents duplicates; ambiguous delivery
requires checking LinkedIn and cannot be automatically retried. No real LinkedIn
post or paid AI request is required or performed by fixture verification.
