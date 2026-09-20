# IDOR & Authorization Scanner (v2)

A browser-based helper for testing Broken Access Control / IDOR issues on
targets you are **explicitly authorized** to test (e.g. a scoped bug bounty
or client engagement). It is not a general-purpose scanner and has no
capability beyond making HTTP requests you configure to a single origin you
grant it access to.

## Load it

1. `chrome://extensions/` → enable **Developer mode** → **Load unpacked** →
   select this folder.
2. Open the target site in a tab and log in as your primary test account.
3. Click the extension icon.

## Scope gate (required before every scan)

1. Enter the target origin and click **Request permission for this origin**.
   Chrome will show a permission prompt — this is what keeps the extension
   from touching anything outside the one origin you name.
2. Tick the authorization checkbox. Both this and step 1 must be done before
   **Start Scan** unlocks.

## Mode 1 — ID Enumeration

Sweeps a numeric ID range under your *current* logged-in session and
compares each response against a baseline response for a deliberately
invalid ID. Many apps return `200 OK` with an "access denied" or "not found"
body instead of a proper 404/403, so raw status-code checks (like a naive
scanner) produce false positives — the baseline diff catches that.

## Mode 2 — Auth Diff (the actual authorization test)

This is the part a pure ID-enumeration script can't do, and it's the core
idea behind tools like Burp's Autorize: request the *same* resources twice —
once as your normal session, once as a second, lower-privileged session —
and compare the two responses.

1. Log into a second test account in a private/second browser profile (or
   just grab its session cookie from DevTools → Application → Cookies).
2. Paste that account's `Cookie` header value (and/or an `Authorization`
   header, for token-based APIs) into the Session B fields.
3. Run the scan. For each ID it fetches as Session A, then temporarily
   rewrites just the `Cookie`/`Authorization` header for requests to your
   authorized origin (via a scoped `declarativeNetRequest` session rule —
   your real browser cookies are never modified), fetches as Session B, then
   removes the override.
4. Anything flagged `POTENTIAL IDOR` — status 200 for Session B with a
   response nearly identical to Session A's — is a lead, not a confirmed
   finding. Verify manually (compare full bodies, check for user-specific
   fields) before reporting.

## Export

CSV/JSON export buttons dump `lastResults` for pasting into your
`reports/` files.

## Limitations / honesty notes

- **Response similarity is length-based**, not a full body diff. It's a
  fast triage signal, not proof — always manually confirm hits.
- **Cross-origin CORS** can still block reading response bodies if the
  target's CORS policy doesn't allow it from that page's origin; requests
  route through the page context specifically to minimize this, but it's
  not bypassable and shouldn't be.
- **Rate limiting is your responsibility** — the delay field is a floor,
  not a guarantee the target can handle the load. Respect your engagement's
  agreed rate limits and only test IDs/accounts covered by your scope.
- Session B override only works for cookie- or header-based auth. It won't
  help with more exotic auth schemes (mTLS, signed request schemes, etc.).

  Download and extract the zip
Click the file card above to download idor-scanner-extension.zip to your Windows Downloads folder. Right-click it and choose "Extract All..." — do not try to load the .zip itself into Chrome, it needs to be a plain folder first. Pick a permanent location (not Downloads, since you might clear it later) — something like C:\Users\<you>\Tools\idor-scanner-extension.

Open Chrome's extensions page
Open Chrome and go to chrome://extensions in the address bar (type it directly, it won't show up as a search suggestion).

Turn on Developer mode
There's a toggle labeled "Developer mode" in the top-right corner of the extensions page. Switch it on — this unlocks the "Load unpacked" option, which is how you install an extension that isn't from the Chrome Web Store.

Load the unpacked extension
Click "Load unpacked" (top-left) and select the extracted idor-scanner-extension folder itself (the one containing manifest.json, popup.html, etc. — not its parent, and not a zip). Chrome will install it immediately and show its icon.

Pin it and check for errors
Click the puzzle-piece icon in Chrome's toolbar and pin the scanner so it's always visible. If the extensions page shows an "Errors" button in red on the card, click it — that'll show any typo or manifest issue rather than failing silently.

Grant scope permission before scanning
Open the target site's tab, log in, click the extension icon, enter the target origin, and click "Request permission for this origin." Chrome will show a permission popup — accept it, then tick the authorization checkbox to unlock Start Scan.
