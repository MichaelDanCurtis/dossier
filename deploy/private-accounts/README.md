# Private-account deployment companion (prototype)

Optional companion for a small, invite-only group on a Docker host with Traefik.
This is a fork prototype for discussion; it is not an upstream-supported installation mode.

Up to five invite-only accounts share one sign-in page. Each has an independent
Dossier app, PostgreSQL database and credentials, storage volume, encryption
secret, background jobs and Docker network. The gateway is the only service
connected to the existing HTTPS proxy. No app/database port is published.

## Manage accounts from the app

Sign in as `admin`, then choose **Manage users** from the app or open
https://dossier.example.com/_accounts/admin.

- Create a username and enter a password of at least 12 characters, or leave it
  blank to generate one. The resulting password is displayed once.
- Expand an account to reset its password, disable access, or re-enable it.
- Password resets and access changes revoke that account's existing browser
  sessions and MCP credentials. Other users remain signed in.
- Setup can take up to two minutes. Existing users can keep working. A failed
  setup remains disabled; use Retry setup, then reset its password if needed.
- Your administrator account cannot disable itself. There is no destructive
  account deletion action. Disabled accounts retain their data and allocated slot.

New users are ordinary users and cannot access user management. Account changes
use a root host service with a private Unix socket and a restricted operation
list. The web container has no Docker socket or arbitrary host command endpoint. Only server registry roles determine administrator access.

## OpenAI Decisions scoring

Both onboarding's Scoring step and Settings → Scoring offer **Your AI model**,
**Jev by TypeSafe**, and **OpenAI Decisions**. Decisions uses the documented
`POST https://api.openai.com/v1/decisions` endpoint with `gpt-6-luna`.

Enter your OpenAI API key in the Decisions key field, then use Test connection.
This key is encrypted separately from Jev and the generative AI provider key,
and belongs only to the signed-in account. Your OpenAI project must have access
to the Decisions API. Requests use the posting and profile evidence without
name, contact fields or references; review the data before scoring. They are
billed to your key. No model or scorer is selected automatically by the upgrade.

Typed score, choice and predicate answers use the same job-fit rubric as Jev.
Refusals, missing/duplicate answers, invalid choices and out-of-range values
fail clearly. Drafts continue to use the generative AI provider. Usage is shown
under Scoring postings with OpenAI Decisions. Scoring credentials are excluded
from normal data exports; full database backups preserve their encrypted values.

## HTTP MCP

Endpoint: **https://dossier.example.com/api/mcp** (Streamable HTTP over HTTPS).

Open **Settings → MCP connector** in the app, or
https://dossier.example.com/settings?section=connector. Turn on **Let apps connect**, then generate a personal MCP token and
save it privately. In Codex, Claude Code or n8n, configure the HTTP server URL
above and this request header:

```text
Authorization: Bearer <your personal MCP token>
```

Tokens are shown once and expire after 90 days. Generating a new personal token
revokes the previous personal token. **Disconnect all apps** revokes every
personal token and OAuth grant for your account. Resetting the account password,
disabling it, or using Dossier's Disconnect/Off controls also invalidates access.
The normal MCP client handles initialize, notifications and protocol headers.

Each token selects only its owner's backend; a browser cookie or caller-supplied
username cannot switch its account. The native Dossier MCP tools read profiles,
applications and postings, search jobs, and save drafts. They never send
applications or delete data. A connected client's operator receives the data its
tools read. Job-source calls may use the owner's configured source quota.

Browser OAuth is also available for compatible clients: authorization-code flow,
S256 PKCE, explicit per-account consent, single-use codes, rotating refresh
tokens and revocation. Public metadata is at
`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/api/mcp`.
Desktop-app sign-in endpoints remain unavailable through the gateway.

## Host operations

Existing login credentials remain valid. Host-side account commands also work:

```sh
dossier-admin list
dossier-admin add alice --generate --credentials-file /root/dossier-alice.txt
docker compose -f /docker/dossier/docker-compose.yml up -d
dossier-admin reset-password alice
dossier-admin disable alice
dossier-admin enable alice
systemctl status dossier-control.service
docker compose -f /docker/dossier/docker-compose.yml ps
```

The GUI uses the controller to start a new account and attach its network without
restarting the gateway. A manual Compose change may briefly recreate it. Account
passwords are scrypt hashes. Credential files are mode 600. Never copy registry,
environment, token, database or credential files into chat or source control.

The gateway's public health check is `/_accounts/health`; it validates gateway
configuration. Docker separately checks each app and its database. To inspect:

```sh
docker compose -f /docker/dossier/docker-compose.yml logs --tail 100 gateway
journalctl -u dossier-control.service --since '1 hour ago'
```

## Backups and source

Before any upgrade, save protected configuration copies and PostgreSQL dumps. Each account's
normal nightly Dossier backups remain on the VPS. Keep protected copies of
account database dumps, `/docker/dossier/state`, `/docker/dossier/secrets`, and the
gateway token volume off the VPS for recovery. Use a consistent SQLite backup or
stop the gateway while copying its token database and WAL; copying only a live
SQLite database file can omit recent grants. Registry/secrets are required to
restore login and decrypt stored keys. The VPS administrator can access all data.

The app image is `dossier-private:1.13.0-accounts2`; the gateway image is
`dossier-private-accounts:2.0.0`. Dossier is based on upstream revision
`6773f4886415b0600ec1f40b5367a816a2a74593` (1.13.0), with the Decisions integration,
account navigation and an authenticated connector-management route. Database
schema is unchanged. The Node base image and JavaScript lockfiles are pinned.

Complete source for both app and gateway is downloadable by signed-in users at
`/_accounts/source` and accompanies this installation under AGPL-3.0-only.
Upstream: https://github.com/AienTech/dossier. OpenAI API documentation:
https://developers.openai.com/api/docs/guides/decisions.

From the repository root, build the companion and its matching app image:

```sh
python3 deploy/private-accounts/package_release.py --app-source . \
  --gateway-source deploy/private-accounts \
  --output deploy/private-accounts/deployment-source.zip
docker build --target production -t dossier-private:1.13.0-accounts2 .
docker build -t dossier-private-accounts:2.0.0 deploy/private-accounts
```

Verify changes in a disposable two-account deployment before upgrading. Do not
run `test/production.mjs` against real user accounts: it writes fixture data,
resets an account password and disables an account. Gateway tests use `npm ci &&
npm test`; controller tests use `python3 -m unittest discover -s test -p '*_test.py'`.
Decisions transport tests use fixtures and do not send paid OpenAI requests.

## Deployment scope and remaining work

The tested deployment was an upgrade of an existing private-account installation.
The host scripts and systemd unit expect `/docker/dossier`; the Traefik entrypoint
is `websecure`, its certificate resolver is `mytlschallenge`, and its external
network defaults to `root_default`. Adapt these to your own host. The root
controller deliberately has no TCP listener and the web gateway has no Docker socket.

Fresh-install bootstrapping is not automated in this prototype: the registry must
select the matching custom app image, assign the initial administrator role, and
supply the corresponding `DOSSIER_ACCOUNT_ROLE` to each backend. `manage.py` still
contains the original single-user image fallback; do not treat its bare `init` / `add`
commands as an installer for this release. The one-off site migration script and
all deployment state, credentials and generated archives are intentionally absent
from this repository.

Browser pages use Dossier's bundled Geist and Newsreader fonts, its design tokens,
and the existing `dossier_theme` cookie. MCP controls live in Settings → MCP
connector; the old account page redirects there. The gateway routes to each
account's existing native MCP server rather than implementing a second tool catalog.

Runtime secrets, password handoffs, token databases and source archives must never
be committed. Run the companion checks from this directory. The disposable
integration script is included for reference, not as a production smoke test.
