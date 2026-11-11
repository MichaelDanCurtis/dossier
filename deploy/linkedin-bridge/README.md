# Private LinkedIn browser bridge

A server-side persistent Chromium profile per CareerAI account. Cloudflare’s documented `challenges.cloudflare.com` verification resources (including its challenge subdomains) are permitted by the resource allowlist so the user can attempt verification normally. This does not solve challenges automatically or guarantee Cloudflare accepts an automated browser. No third-party MCP package, cookie export, password storage in CareerAI, stealth plugins, fingerprint changes or challenge bypass. The collector only navigates and reads job pages. No application, publishing or message tool exists in this service.

## Use

LinkedIn → Browser bridge → Open browser / sign in. Click the remote page, then use the text entry field and keyboard buttons. The text field is masked by default and cleared after each entry. Complete MFA/checkpoints yourself. Close browser control to flush the persistent profile and allow collection.

Enter job keywords and location and start a collection. One search page, at most eight descriptions, at least 30 seconds between navigation starts, at least 15 minutes between runs, at most 40 collection page navigations per UTC day. Budgets and recent results persist across restarts. No pagination, automatic retries, automatic daily scans, CAPTCHA solving or alternate proxies. A challenge, 401/403/429/999, incomplete job, or unexpected error stops collection. Stop and opening manual control cancel collection, including its pending wait. A navigation already in progress can take up to 30 seconds to stop.

Review descriptions and save selected opportunities into CareerAI. Saving is idempotent through the existing canonical LinkedIn job ID. The provenance identifies a reviewed browser import. Only full descriptions are imported; remote/pay are not guessed. Score saved opportunities in Job Agent. To apply, open the reviewed job in the browser, inspect the form, upload your chosen PDF/DOCX or PNG/JPEG/WebP if requested, and click LinkedIn's final submit yourself. CareerAI never marks an application Sent based on collection/opening a page.

Manual browser control expires after 15 minutes without activity. A new window takes over the lease. Screenshots and inputs require both the app session and a current lease. Close/disconnect flushes/closes the browser. Disconnect removes its profile and unsaved results, retaining rate budgets and already-saved CareerAI jobs. External sites/popups and WebSockets are blocked: use Open original in your own browser for an employer's external application or an unsupported sign-in provider. A personal post can be published only by the existing exact-text reviewed OAuth action; images can be downloaded and manually attached through LinkedIn. The collector cannot publish anything.

**Pacing is load control, not LinkedIn permission.** LinkedIn prohibits unauthorized scraping/automated activity. An account can encounter restrictions even at low request rates. Review https://www.linkedin.com/help/linkedin/answer/a1341543 before use.

## Deployment

The main production Dockerfile includes the service and matching Playwright Chromium. `deploy/private-accounts/manage.py` enables one private sidecar per account when the private registry has `"linkedinBridge": true`. It derives a dedicated service token from that account's app secret, configures only its app with `LINKEDIN_BRIDGE_URL`/`LINKEDIN_BRIDGE_TOKEN`, and assigns a separate browser volume. Account provisioning includes the sidecar. Keep the compose/registry files private. No host port, CDP endpoint or VNC viewer is exposed. The browser service has no database or AI credentials. Only the account's app proxies requests, using normal session and same-origin checks.

For another installation, run `node deploy/linkedin-bridge/server.mjs` from the production image, set `BRIDGE_TOKEN` to a new 32+ character random secret and `BRIDGE_DATA_DIR` to a writable persistent directory. Give the app the matching `LINKEDIN_BRIDGE_TOKEN` and internal `LINKEDIN_BRIDGE_URL=http://bridge:8090`. Do not publish 8090. Protect browser volumes/backups as login credentials. This initial version uses filesystem access controls, not application-level encryption of Chromium's profile.

## Checks

Node 24: `node --test deploy/linkedin-bridge/bridge.test.mjs`. Tests cover destination restrictions, persistent budgets, session/lease isolation, no submission endpoints, per-action manual approval and stop-on-rate-limit. App image tests cover fixed OpenAI/OpenRouter routes and image-output model validation. Use a disposable LinkedIn account only if separately authorized for live testing; never post/apply as a release check.

OpenRouter image routing follows https://openrouter.ai/docs/guides/overview/multimodal/image-generation: GET `/api/v1/images/models`, POST `/api/v1/images`, selected model and no provider fallbacks. Direct OpenAI remains on `/v1/images/generations`. Neither route sends a key to an arbitrary compatible URL. Output is limited to inline PNG/JPEG/WebP bytes; SVG and remote image URLs are refused. No paid generation occurs until Generate image is clicked.
