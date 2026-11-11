# Opportunity briefing, interview coach and repository discovery

Career has URL-backed tabs for conversations, opportunities and repositories. The sidebar stays unchanged. Applications link to the briefing form; saved postings and scored Agent opportunities can be selected without preparing an application first.

## Decision and practice flow

A briefing records a dated snapshot of the actual posting, contact-stripped Profile, accepted preferences, selected experience/project evidence and an optional user-supplied company excerpt. It runs as a durable `career-turn` job. Evidence citations must refer to entries in that snapshot; company-excerpt citations require an excerpt. Facts can be inspected beside the conversation. Availability is not refreshed, and independent company research is not claimed.

The interview coach uses the same snapshot, asks one question per turn, adapts to answers and prepares a debrief on Finish for review. Answers remain private conversation history. Neither briefings nor practice can create profile proposals or submit applications. Start a new briefing after changing Profile. A later conversation can discuss notes from a real interview without guessing an employer's motives.

Generations are bounded to two provider requests per turn, including structured-output retries: 6,000 output tokens for briefings, 2,500 for practice. Usage records distinguish briefing and practice. Input history and sources are bounded; providers' prices still apply. Failed responses retain the saved request and use the existing retry flow.

## Repository research

Public discovery lists GitHub repositories in pages of 30. A selected repository is previewed using metadata and a README pinned to a commit. Requests use a fixed GitHub API origin, no redirects or credentials, bounded response sizes and timeouts. No cloning, build execution, cookie access or background scans occur. GitHub public API limits surface to the user without paid generation.

The user explicitly chooses a research model from a saved provider and reviews the material before sending it. Each turn is limited to two requests of 2,048 output tokens, with low effort where supported. Private work can be supplied through selected documentation excerpts; there is no server-side private repository credential in this slice.

Repository observations, fork status and ownership do not establish personal contribution or outcomes. The first response cannot create proposals. Subsequent PROJECT/UPDATE proposals require supporting USER-origin answers and remain pending for explicit acceptance through the existing stale-record checks. LinkedIn project wording is a private draft for manual review and use; this feature cannot publish it.

## Persistence and checks

The existing extensible CareerSession/Message/Proposal tables store these kinds; no database migration is needed. Conversation history and source snapshots travel in private workspace exports. Account-specific databases and native MCP access remain unchanged. Every new server action uses the authenticated action wrapper.

Tests cover snapshot retention/contact exclusion, source-ID rejection, saved posting selection, practice isolation, repository proposal gating, bounded GitHub reads, provenance, request durability and export validation. Browser checks use a separate SQLite database and a local mocked AI endpoint; live provider acceptance is recorded separately.
