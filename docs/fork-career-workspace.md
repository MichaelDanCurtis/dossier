# CareerAI: Career workspace and opportunity workflows

CareerAI is our private fork of [Dossier](https://github.com/AienTech/dossier), licensed under AGPL-3.0. It adds first usable versions of the private roadmap ideas. They share the existing account-specific application and database. New provider keys, Google connections and MCP tokens are not required by this change.

## Career

Career contains resumable interviews, project updates, career reviews and the resume coach history. Answers are durable before AI work begins. Questions use the saved profile and accepted preferences, with contact fields omitted from profile prompts. Answers themselves are sent to the configured AI. Users can skip, correct, pause and resume. AI changes are pending proposals with supporting answers; accepting is a separate action. New achievements are never silently promoted into Profile. Planned/in-progress certifications stay in the career timeline; only reviewed earned or expired credentials enter the factual certification list.

Optional weekly/monthly check-ins are off initially. They summarize reviewed updates and previously saved high-fit Agent candidates, without claiming a new search or LinkedIn synchronization. The local current period becomes eligible after 09:00 in the saved browser time zone. Missed periods are skipped; changing cadence cannot create a burst. Each scheduled review has at most two provider HTTP generation attempts, capped at 2,048 output tokens per attempt, including SDK/network/format fallbacks. A provider that cannot answer within this allowance fails visibly and waits for a manual retry. Model-specific compatibility operations can also consume this allowance. Usage uses the existing task counters and provider rates.

## Resume content, coach and focus variants

Base resume adds Content and Coach panels beside the document preview. Manual text edits can be previewed, saved or cancelled. Named variants select a subset of shared profile entries and keep separate wording/focus. Employers, titles and dates remain canonical profile fields. Base includes new entries automatically; a named variant retains its explicit selection. Saved versions restore wording/selection while retaining current factual profile details. Credentials, publications and custom sections are edited in Profile.

The coach proposes before/after text, reasons and fact-check flags. Acceptance saves a new variant version; stale edits require a fresh suggestion. New manual, Agent and connector drafts capture the selected resume before generation. Changing the active variant afterwards does not replace the source used by that draft. As in upstream Dossier, application headers follow factual Profile edits until sent or explicitly updated; employer history records the exact rendering inputs at export/send.

## Employer history

Tailored PDF export, bulk PDF ZIP export, first marked-sent transitions and Gmail sending reserve an immutable package before rendering or delivery. Every attachment uses that reserved snapshot, including document text, factual headers, photo, section layout, date, language and themes. Separate append-only events distinguish reservations, failed preparations, exports and sends. Undoing a status or deleting an application does not rewrite package history. Delete everything explicitly removes it.

The comparison flags contradictory shared employment/education/credential records for the exact normalized employer name. Different wording and ordinary omissions are allowed. Switching between concurrent jobs in two focused resumes for the same employer also prompts a review, even when neither set of dates is false. Parent-company aliases are not inferred. Acknowledgement is tied to the current package and conflicting history hashes; later changes invalidate it. Recent unfinished preparations are conservatively included for 15 minutes. A failed render is not an export, and an unconfirmed mail attempt is not a recorded successful send.

Older Sent applications contribute the currently available frozen copy as LEGACY_SENT, explicitly distinguished from observed exports/sends. This cannot reconstruct an old file that was never retained. Existing manual submissions outside Dossier are only known when recorded in the app.

## Company boards

Company boards follows chosen Greenhouse, Lever or Ashby board names through their documented public read interfaces. It is a targeted watchlist, not a global JSearch replacement or application-submission API. Adding checks once; ongoing polling is optional and off by default. Metadata polls use a 6–168 hour cadence. Enabled Greenhouse boards enrich at most ten queued descriptions per check, revisiting enrichment every 15 minutes. The scheduler considers up to three due boards per tick.

Each complete listing is validated and persisted separately from description enrichment. HTTP 304 requires a valid durable listing; otherwise it is retried without validators. Lever pages must complete with no duplicate IDs; scans cap at 2,000 Lever roles and 10,000 other listing records. Responses cap at 12 MiB, use fixed HTTPS ATS hosts and public DNS checks, and refuse redirects. Source calls carry no user keys or preferences. Failures preserve observations. Missing roles close only after two complete missing observations separated by the configured cadence; large/empty drops require confirmation. Leases have generation fences so stale workers cannot overwrite a newer board change or imported cache.

Cached keyword and explicit-remote filtering make no country/radius coverage claim. Incomplete descriptions wait before drafting/scoring. Save/dismiss/application state and URL deduplication reuse existing Dossier behavior. The optional Score new roles action evaluates at most ten new complete postings through the existing scorer and never auto-drafts.

Primary interfaces: [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api). These public-read interfaces do not grant blanket redistribution rights. Arbitrary websites, browser crawling and proxy-based evasion are outside this version.

## LinkedIn assisted workflow

LinkedIn accepts a user-supplied full posting and job URL. Canonical job identity removes tracking parameters and prevents duplicate imports. Imported roles use the existing scoring, tailoring, PDF and application tracking flow. Submission, LinkedIn messages and Easy Apply remain manual; generated materials never mark a job submitted automatically.

No LinkedIn session cookies, scraper MCP or partner credentials are collected. Ordinary self-service API access does not establish a full job-seeker workflow or full-profile synchronization. Supported automation remains gated on verified app permissions/partner access. Users can bring their own career updates into Career in the meantime. [LinkedIn access guide](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access).

## Reviewed personal website export

Personal website starts with every field unchecked. A user selects explicit profile fields/records, previews the static site, confirms its public content and downloads a ZIP containing index.html, content.json, manifest.json, site-brief.md and agent-handoff.md. The server checks the selected-content hash again at export so changed facts require another review. The allowlist excludes private facts, preferences, transcripts, references, credential IDs, applications and keys. Text is escaped and links restricted to HTTP(S).

The ZIP is a working static site and a handoff for Codex/Claude Code customization. Export does not publish a domain. Public virtual-you AI chat is a separate extension requiring its own protected backend, public knowledge allowlist, cost controls and publication review; no model key or public chat endpoint is shipped.

## Backups and operations

Private exports are version 12 and include career provenance, variants/versions, package history, and company-board configuration. Older backups load without these histories. Private exports carry each immutable package photo once and verify its content hash when restoring, keeping repeated images out of every serialized package. Public company caches, leases, validators, active job IDs and acknowledgement hashes are not restored; they must be rebuilt or reviewed again. Account-data deletion clears the new tables. The local roadmap, work directory, fixture credentials and private planning artifacts remain excluded from Git and deployment archives.

New source is staged in the fork first. Feature proposals upstream follow real trial and feedback, rather than being filed as part of implementation. The upstream bug-fix PRs remain separate.

## Local branding

CareerAI names this private fork in the app, sign-in/admin pages, browser titles and connector descriptions. The upstream project and release notices retain Dossier attribution. Existing domains, cookie names, environment variables, database/export formats, OAuth scopes and MCP tool identifiers remain compatible.
