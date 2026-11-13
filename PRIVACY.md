# Privacy

Dossier is a single-user app you run on your own server. This page is for whoever runs it: what Dossier keeps and for how long, what leaves your server and who receives it, and what deleting something removes. For how the data is protected, see [SECURITY.md](SECURITY.md).

CareerAI stores your profile, documents and application history in your own database and data directory. Its network requests support the services you choose: AI providers, job sources, company boards, Google, GitHub, LinkedIn, and other connected tools described below. CareerAI does not fetch upstream surveys, announcements or release alerts, and does not send usage pings. With a hosted AI provider, the information needed for a requested AI task leaves your server even though the database stays with you.

## What Dossier keeps

| What | Where | Kept until |
|---|---|---|
| Your profile: basics with contact details and your photo, skills, languages, roles, projects, education, certifications, publications, references with their email and phone, and your facts about you | Database | You change or delete it |
| Each application: the posting, what was read from it, the match, the facts you gave for it, its status history | Database | You delete the application |
| Each application's resume, cover letter and email, every earlier version of them, the refine chat and your private notes. Once it's sent, a copy of your profile as it was then, without your photo, so that the resume stays what you sent: deleting a role from your profile doesn't take it out of that copy | Database | You delete the application |
| Postings you saved or dismissed in Find jobs, and your past searches with what they found | Database | You remove them. A posting stays, unlinked, when you delete the application made from it |
| The job agent's finds: each posting it scored, with its score, reasons and red flags, and the drafts it prepared. A dismissed posting keeps its source's ID, title, company, score and a fingerprint of its link so it never comes back; its posting text, link, reasons, draft and search labels are removed | Database | Dismissing a posting trims it at once and deletes its draft. Delete everything removes them all |
| The job agent's recurring searches: up to three names, queries, enabled states and order; on candidates, the names of searches that found them. Recent run history holds per-search discovery counts/errors and a shared source-request quota ledger, not raw result pages | Database | You edit/delete searches; historical candidate labels survive search rename/delete, but are removed when the candidate is dismissed or deleted, or with Delete everything. Recent run history is bounded; quota slots expire after 24 hours |
| The scores of postings you scored with **Score** in Find jobs, or the job agent scored: each score with its reasons and red flags | Database | Scoring again replaces one. Importing a file or Delete everything removes them; exports leave them out, since they can be made again |
| Startups: each startup a refresh found (the hiring post or job post as published, its links, place and roles), its match with the reasons, the email addresses it publishes for applications with where each was found, and your status and notes. People's own addresses only after you press **Look for people's addresses**. Of a startup you removed for good, only SHA-256 hashes of its post, its site's domain and its name, so it doesn't come back | Database | Ones you didn't save, contact or write to go once no refresh has found them for 45 days. People's own addresses go after 14 days, unless you started an application to that startup. **Remove for good** deletes a startup at once. Delete everything removes them all |
| Postings you hand to Claude chat from New application, with **Write it with Claude**, for the MCP connector to read | Database | 14 days, or Delete everything |
| Task data: what each AI task was given and wrote, such as a posting being read, a resume's text and what was read from it, drafts you didn't turn into an application, and a rewrite kept for Undo | Database | The task's application is deleted, or it's older than **Keep task data for** (Settings → Your data: 1 hour, 24 hours, 7 days or 30 days; 24 hours by default), whichever comes first. A resume reading goes as soon as you merge, replace or choose another file |
| Mail from Gmail about your applications, once you connect Google: who it's from and to, the subject, the date and the text (without quoted earlier mail, up to 20,000 characters, never attachments), what the AI read in it, and the answer it drafted. Also what you sent through Dossier, and your own mail in those threads | Database | You delete its application. Mail Dossier couldn't link (**Needs a look**) stays until you link it or mark it **Not job-related**, which keeps only its Gmail IDs and date, so it isn't fetched again |
| The connected Google account: its address, the permissions you gave, and Google's refresh token, encrypted with `DOSSIER_SECRET`. Where the inbox check carries on from, and when it last ran. For each interview Dossier added to your calendar, the event's ID | Database | **Disconnect** in Settings → Google, or Delete everything. An interview's event ID goes when its date does |
| Settings, and your API keys and the Google OAuth client's secret, encrypted with `DOSSIER_SECRET`. While the MCP connector is on, when it was turned on or every app was last disconnected, and the callback addresses of other apps you added; the sign-in itself keeps nothing: its tokens are signed with `DOSSIER_SECRET` | Database | You change them |
| Nightly backups and the backup taken before each import: full exports, in plain JSON | Data directory, `backups` | `DOSSIER_BACKUP_RETENTION_DAYS`, 14 days by default |
| Zips from **Download all PDFs** | Data directory, `downloads` | Downloaded, or an hour |
| The tokens each AI request used: for each request to your AI model or to Jev, which task asked, the provider and model, when, and the token counts its server reported, for the Usage screen. Never the prompt or the answer | Database | Delete everything. Exports leave them out |
| Failed sign-ins: the client IP and how many failed | Database | A successful sign-in from that IP. Otherwise, once they're a day old, the next failed sign-in clears them |
| Inert legacy upstream consent, install IDs and cached releases from older installations; the browser's time zone for the inbox check; and when you last opened Startups and what its last refresh found | Database | Delete everything |

Exports you download and database dumps you take are copies outside Dossier's reach: keep them safe, and delete them yourself. Dossier logs errors without the data involved; what your server, Docker or reverse proxy log otherwise is up to your setup.

## What deleting removes

- **Deleting an application** removes it at once with its documents and their versions, the chat, notes, status history, task data and its mail from Gmail (which stays in Gmail). Nightly backups taken before still hold it until they expire, and so do exports you downloaded.
- **Deleting a recurring agent search** stops future use of it but leaves existing candidates, saved postings and applications alone. Candidates keep the original search name as history, including a label for a deleted search; renaming a search does not rewrite it. Dismissing or deleting a candidate removes its search attribution. Schema 8 exports and backups include searches and candidate labels; schemas 1–7 import a meaningful old single search as “My search”, without inventing historical labels. The installation's quota/run ledger is not exported and survives imports, so restoring does not reset the request budget.
- **Delete everything** (Settings → Your data) removes the profile, every application, postings and searches, the job agent's finds, Startups, custom themes, settings, task data, the token counts, backups and zips, the mail from Gmail and the Google account, after revoking Dossier's access at Google. It can't reach your own exports and dumps, what's in your Gmail and calendar, or what a hosted AI provider kept.
- **Disconnect** (Settings → Google) revokes Dossier's access at Google and forgets the account. Mail already in Dossier stays, with its applications.
- **Disconnect all apps** (Settings → MCP connector) signs Claude and every other app out, and so do turning the connector off, a new `DOSSIER_PASSWORD` or a new `DOSSIER_SECRET`. What an app read before stays with it: for Claude, in your Claude chats, under your Claude account.

### Saved AI-provider configurations

Switching providers keeps each server's endpoint, model and encrypted key so you can return to it later. Only the selected provider is used for AI tasks. Keys are scoped by provider kind and server origin and are never returned to the browser. **Remove saved key** affects that server's key; it does not erase the other configurations. Already removed keys cannot be recovered by remembering configurations later.

The saved-provider history stays on this installation and is excluded from ordinary data exports, even when you choose to include the active provider's key. Full database backups contain its encrypted keys and still require the same server secret to decrypt them.

## What leaves your server

| Who receives it | When | What |
|---|---|---|
| A hosted AI provider (OpenAI-compatible, Anthropic or Mistral) | Each AI task, while one is chosen in Settings → AI provider | See [below](#what-a-hosted-ai-provider-receives) |
| Google | While a Google account is connected (Settings → Google) | Signing in: your OAuth client's ID and secret, and the tokens. **Gmail:** the application emails and answers you send, with their PDFs, and a request for new mail on each check (every 10 minutes by default). **Calendar:** the next 14 days, to find your free times; each interview you add, change or remove: its time and a title with the role and company; and requests for the events in the months you look at in the dashboard's calendar, which Dossier shows and doesn't keep. Google already holds your mail and calendar; Dossier only asks for the permissions you give |
| The job source you chose (JSearch, Adzuna, FreeHire or the Bundesagentur für Arbeit) | Each search in Find jobs, which is off until you choose a source. While the agent is on, each enabled recurring search requests its first page sequentially, sharing at most three requests per rolling 24 hours (attempted failures count; never on the Bundesagentur für Arbeit) | What you search for: keywords, place, country, radius and filters. Nothing from your profile: it only fills in the form. FreeHire is a public catalogue (or your self-hosted FreeHire via `DOSSIER_FREEHIRE_URL`) and needs no key. The Bundesagentur für Arbeit has no official API: Dossier uses the access its own job search uses, without its permission, so it's searched only after you tick "I understand" under that note, and `DOSSIER_JOBS_ARBEITSAGENTUR=off` takes it out |
| Hacker News (its official API, and Algolia's search of it) | When you press **Refresh** in Startups, then once a day while you open Startups at least every 14 days | Requests for YC startups' job posts and this month's “Who is hiring?” thread. Nothing about you: which posts suit your city and country is worked out on your server |
| Startups' own sites | Each Startups refresh, for the 12 best new matches with a site of their own, and when you press **Find addresses on their site** or **Look for people's addresses** | Requests for the site's robots.txt and a few public pages. See [Startups](#startups) |
| TypeSafe (Jev) | Each posting you score, with **Score** in Find jobs or by the job agent, only while **Jev by TypeSafe** is chosen in Settings → Scoring (your AI model scores until you choose it) | See [below](#what-typesafe-receives) |
| OpenAI Decisions (optional in this fork) | Each posting scored while OpenAI Decisions is selected in Settings → Scoring | The same job-fit rubric and posting/profile evidence used by Jev, excluding name, contact fields and references. Requests go to `api.openai.com/v1/decisions` with your separately stored key. No paid live request was used to validate this prototype. |
| Anthropic, through Claude | Only while the MCP connector is on (Settings → MCP connector, off by default), and only for the Claude you signed in and allowed: each time Claude uses one of Dossier's tools | What that tool answers. See [MCP connector](#mcp-connector) |
| Another MCP app you connect, such as n8n | Only while the MCP connector is on, only for an app whose callback address you added in Settings → MCP connector, and only after you signed in and allowed it: each time it uses one of Dossier's tools | What that tool answers, to whoever runs the app. See [MCP connector](#mcp-connector) |
| The site a posting is on | When you press **Fetch** on a new application, and for a Find jobs posting that came with only its start | A request for the posting's page, from your server, never to an address on your own network |
| GitHub | When you connect an account and select repositories to review | Account and repository requests. Selected repository content is sent to your chosen AI provider when you request a review; the saved connection token is encrypted on your server |

The app does not contact the upstream project for surveys, announcements, releases or usage analytics. Next.js telemetry and the Prisma tool's check-in with checkpoint.prisma.io are both off.

The agent's searches share one daily schedule and one AI score/draft limit per batch, not a limit per search. The whole batch waits until its source requests fit the rolling budget, so quota deferral can shift its run time. After an interruption every reserved request still counts, even if not sent. Per-search “source request completed” and found/new counts describe collection, not successful model evaluation; searches may overlap, and the batch outcome reports evaluation failures separately.

### What a hosted AI provider receives

| Task | What's sent |
|---|---|
| Reading a posting | The posting's text, up to 20,000 characters |
| Matching it against your profile | The posting's requirements, and the names of your skills and languages |
| Writing the resume, cover letter and email | Your profile without contact details: your name, headline, city and country, summary, skills, languages, roles with their companies, places, the line about each company or role, dates and bullet points, projects with their dates and bullet points (not their links), education, the certifications you show on resumes with who issued them and their dates (not their links or credential IDs), the publications you show on resumes (not their links), and your facts about you. Also the job's details and the match, the letter's tone, and the facts you gave for the application. The email also gets the posting and the letter's paragraphs |
| Rewriting a part, or refining in the chat | The same, with the drafts (never a letter's sender or signature) and, in the chat, your request and the recent messages before it |
| Importing a resume | The whole text of the file, contact details and references included. The import page says so first |
| Scoring a posting, with **Score** in Find jobs or by the job agent, unless Settings → Scoring chose Jev | The posting's text, with its title, company, place and salary, and your profile without contact details or references, as for writing. Score in Find jobs fetches the rest of a posting the source sent only the start of. Each time you press Score, and up to the number of postings an agent run scores (Settings → Job agent) |
| The job agent's drafts | The same as reading a posting and writing its resume and cover letter, for each draft you prepare or, with Prepare drafts on its own on, up to the number a run prepares |
| Reading a reply from Gmail | The mail's sender, subject, date and text (up to 8,000 characters), the application's role and company, and your time zone. With **Every new email** in Settings → Google, that's each new mail outside Promotions and Social |
| Drafting an answer to it | Your profile without contact details, as for the documents, the job's details and the facts you gave for it, the mail and up to four earlier ones in its thread (up to 2,000 characters each), the times to offer, and what you tell the AI |

Never sent in a prompt: your email, phone, address, date of birth and links, your references, the notes you keep on an application, and the addresses Startups finds: a startup's text reaches New application without them, and the email's recipient is filled in on your server. A posting may name a contact person, a mail from an employer has its sender's name and address, and what you write in the chat may mention people, so other people's details can still be sent.

What happens to the data then depends on the provider and your account with them: how long they keep it, whether they use it to train models, and where it's processed. Read their terms for API use, and check the settings your account offers, before you send them a resume. LM Studio or an OpenAI-compatible server on your own network keeps everything on it.

### What TypeSafe receives

With **Jev by TypeSafe** chosen in Settings → Scoring, each posting you score goes to TypeSafe AI, Inc. instead of your AI provider: the posting's text (up to 20,000 characters) with its title, company, place, salary and whether it's remote, and your profile without your name, contact details or references: your headline, city and country, summary, skills, languages, roles with their companies, places, dates and bullet points, projects (not their links), education, the certifications you show on resumes (not their links or credential IDs), the publications you show on resumes and your facts about you. Dossier's questions quote the posting's lines. **Test connection** sends one sentence of Dossier's own. Nothing else is sent, and Dossier keeps only the score, reasons and red flags it makes from the answers.

TypeSafe's [privacy policy](https://typesafe.ai/legal/privacy-policy) says it doesn't train or fine-tune models on what you send, that its service is hosted in the United States, and that it keeps data as long as it needs to provide the service, without a fixed period. Its [data processing agreement](https://typesafe.ai/legal/data-processing) covers transfers from the EU with standard contractual clauses. The key and the account are yours, with TypeSafe: read their terms before you choose Jev.

### Upstream prompts and usage telemetry

CareerAI does not include the upstream consent survey, usage-ping sender, announcement feed or Dossier release checker. Opening a page, completing setup, or starting the server cannot enable them. Legacy telemetry and announcement environment variables are ignored, including an old `DOSSIER_TELEMETRY=on` value.

Old database rows for consent, install IDs, cached releases or announcements may still exist after an upgrade. They are inert and remain excluded from portable exports; importing an old backup cannot enable these removed features.

### Startups

Startups lists startups that are hiring: YC startups' job posts from Hacker News' official API, and the posts in Hacker News' monthly “Who is hiring?” thread. It keeps the ones that hire where your profile says you live, or remotely and open to your country, ranks them against your profile on your server, without AI, and shows the address each one publishes for applications. Dossier sends nothing: you decide whom to write to, from New application or your own mail.

**If you run a website** and see requests from `Dossier/<version>`: they come from one person's own Dossier, looking for the address you publish for job applications. The Dossier project doesn't receive anything it reads. It reads your robots.txt first and follows it, under the product token `Dossier`. Then it reads at most your home, `/careers`, `/jobs` and `/contact` pages, and `/about` and `/team` only when that person asks for people's addresses. It reads one page at a time and stops when your site answers 403 or 429. It keeps only the email addresses on your own domain and the page each was on, never the pages, and doesn't decode addresses written to hide them. When a page says you take no unsolicited applications, Dossier shows that and doesn't start an application. To keep it out:

```
User-agent: Dossier
Disallow: /
```

**If you use it:** Startups is for applying for jobs. Offering your services as a freelancer by email is advertising in many countries: in Germany and the rest of the EU it needs the company's consent first, even when the company published the address, and in the US, Canada and Australia such an email needs a way to opt out. Dossier doesn't support that use. Whether the GDPR's exemption for personal activities covers your own job search hasn't been settled, so Dossier treats the addresses as personal data: it looks up people's own addresses only when you ask, drops them after 14 days unless you write to that startup, keeps every address out of what the AI receives, and **Remove for good** deletes a startup and keeps only hashes so it doesn't come back. If someone asks you to delete their address, that's the button.

### MCP connector

The MCP connector lets you use Dossier from Claude: in chats on claude.ai, in the Desktop and mobile apps, and in Claude's command-line app. Other apps that speak MCP, such as n8n, can use it too, once you add their callback address in Settings → MCP connector. It's off until you turn it on there. Then an app can use it once you've signed in to Dossier and pressed **Allow**; while it's off, its addresses answer as if they didn't exist.

Another app gets the same as Claude, below, and whoever runs it decides what happens to it then: read its terms before you add it.

What Claude reads through it goes to Anthropic, under your own Claude account and its terms, as anything you put in a chat does:

- **Your profile,** without contact details, links or references: the same as a hosted AI provider gets for writing.
- **Postings:** what Find jobs searches find for Claude (the searches are kept in Find jobs, like your own), the postings you hand over, and the text of a posting Claude asks for by its link, fetched from your server.
- **Your applications:** their details and status, the posting and the match, and the resume and cover letter as text. Never your private notes, or a letter's sender and signature.

Claude also writes through it: an application it wrote, saved as a Draft and checked like Dossier's own AI's; the fit scores it gives postings; and an application's status. No tool deletes, archives or sends anything. With **Write it with Claude** in New application, the posting you pasted is kept for Claude to read for 14 days; Score and Write it with Claude open a new chat on claude.ai with a short prompt that names the posting by its ID, and nothing else.

Anthropic is the controller of what reaches it through your Claude account, and whoever runs another app you connect is the controller of what reaches it; the Dossier project receives nothing from the connector. Dossier keeps no tokens: the sign-in is signed with `DOSSIER_SECRET`, and **Disconnect all apps** ends it.

## GDPR and similar laws

What applies depends on who you run Dossier for, and this isn't legal advice.

- **For your own job search:** the GDPR doesn't apply to processing for purely personal or household activities (Article 2(2)(c)), though no court has said yet whether a job search counts. Other privacy laws often exempt personal use too.
- **For other people**, such as a career coach, an agency or a service: you decide what happens to their data, so you're responsible for it under the GDPR. Among other things, that means a lawful basis for each use, telling them what this page says (who receives their data, for what, and for how long), a data processing agreement with a hosted AI provider, and safeguards when it processes the data outside the EEA. Resumes can reveal special category data, such as health or religion, and hold other people's details, such as references.

Self-hosting alone doesn't make a deployment compliant. Dossier's code shows what it stores and sends. It can't tell you whether your provider, its terms or your account settings meet what you need.

When someone asks for their data, **Export** in Settings → Your data gives everything Dossier keeps except task data and failed sign-ins, which expire on their own, and the mail from Gmail and the Google account, which belong to the mailbox: the mail is still in Gmail. Deleting an application or **Delete everything** removes data as described [above](#what-deleting-removes).

## Optional private-account companion in this fork

### CareerAI writing and agent workspaces

Profile and resume wording help sends the selected passage, your editing notes
and a bounded profile context (without contact fields or references) to your
configured AI provider. You review and accept a suggestion before it replaces
text. Saved resume wording retains the existing version and export behavior.

Career watch stores your role, employer and optional annual pay in your private
database. Exact current and target pay are excluded from career-review prompts
and publicist prompts. Career reviews can include published job ranges and your
relative position against those individual ranges.

LinkedIn posts, job descriptions and recruiter messages are imported only when
you supply them. Explicit message review sends that message to your AI provider.
Publicist generation sends your brief and selected non-message source excerpts;
it does not read private messages or your salary. Imported content and drafts
are retained until removed or the workspace is deleted, and are included in your
personal data export.

Optional LinkedIn publishing sends an OAuth authorization and identity request to
LinkedIn and sends the exact approved post to the connected member's public
feed. Encrypted app secrets/tokens remain local and are excluded from portable
exports. Disconnect removes the local token; revoke access in LinkedIn settings
to revoke it at LinkedIn. Personal feed and inbox synchronization are not
implemented. Delete everything removes these local settings and sources.

Publicist news refresh sends ordinary public-feed requests to the selected AWS,
CNCF and Microsoft publishers, without profile or salary data. Daily refresh is
off until enabled. It collects sources only and never generates or posts on its
own.

### Account isolation

Each invited person has a separate app process, database, encryption secret,
storage volume and Docker network. The VPS administrator can access the host and
all accounts' data; this does not protect users from the host operator.

With the companion enabled, Settings → MCP connector also manages personal
bearer tokens for clients such as Codex or n8n. These confer access to the same
native tool catalog and only their owner's workspace. Personal tokens are shown
once, expire after 90 days, and are replaced when a new one is generated. The
companion persists token/code hashes and authorization metadata in its own SQLite
database; the native single-user OAuth implementation described above is unchanged.
Account-password resets, account access changes, turning the connector off, and
Disconnect all apps invalidate access. Already retrieved data remains with the
connected client.

The companion's OAuth flow accepts HTTPS and loopback callback addresses through
dynamic registration and requires per-account consent with PKCE; it does not use
the native single-user callback allowlist. Review the requested client and return
address before granting access. Browser OAuth and bearer-token controls share one
Settings page in this deployment mode.

### Publicist workshop additions

Publicist stores the writing preferences and conversation you choose to save,
including audience, public expertise, voice, selected text model/effort, story
angles and visual briefs. Brainstorming and drafting send that context and the
selected source excerpts to the configured Publicist provider. Saved AI
connections keep their own encrypted keys; choosing a Publicist model does not
change the app default or expose the key to the browser. Active generation leases
are omitted from exports.

You can configure industries, keyword filters and exclusions, select publisher
feeds, and add public HTTPS RSS/Atom URLs. Optional industry search sends the
saved industry/topic query to Google News RSS. Public publisher requests do not
include profile fields, private messages, pay, cookies or AI credentials. Daily
collection remains an explicit choice and does not generate or publish content.

Image generation sends the reviewed image prompt and a privacy-preserving
installation identifier to OpenAI using a separately selected saved OpenAI
connection. It makes one request only after Generate image is pressed; it may
incur image API charges. Generated PNGs are held in the current browser until
downloaded and are not included in saved drafts or server backups. Stock-image
search links open the selected search query on the external image site. CareerAI
does not automatically retrieve or license those images. LinkedIn publishing
continues to send approved text only.
