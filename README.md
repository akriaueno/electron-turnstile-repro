# electron-turnstile-repro

Minimal Electron reproduction for **Cloudflare Turnstile error 600010** looping
inside an embedded `<webview>` (the failure seen in T3 Code preview,
[pingdotgg/t3code#5002](https://github.com/pingdotgg/t3code/issues/5002)).

## TL;DR — root cause

Turnstile loops with error 600010 whenever the guest's User-Agent string is
**rewritten to anything other than the native Electron UA**. A plain Electron
`<webview>` with its untouched UA passes; calling `session.setUserAgent()` with a
modified string (whether you strip the `Electron/…` token OR the app product
token) fails.

Why: `session.setUserAgent()` changes `navigator.userAgent` but does **not**
update the Client Hints (`navigator.userAgentData`), which Chromium keeps derived
from its native metadata. So a rewritten UA no longer matches
`navigator.userAgentData`, and Turnstile treats that userAgent-vs-userAgentData
inconsistency as a spoofed browser and fails its integrity check, recreating the
challenge every few seconds. Setting the UA to the *unchanged* native string
(a no-op override) still passes, which proves it is the string content diverging
from the Client Hints — not the act of calling `setUserAgent`, and not any
specific token.

The fix is therefore to **not rewrite the UA at all** (or, if you must, override
`userAgentMetadata` in lockstep via CDP `Network.setUserAgentOverride`, which is
fiddly and easy to get wrong). This is self-inflicted by the UA rewrite; it is
**not** intrinsic to Electron webviews, not WebGL/GPU, not the IP, not
CDP/DevTools, not the preload, and not the granted-permission handlers (all ruled
out — see the toggle table).

## Run it

```bash
npm install            # installs electron@41.5.0 (Chromium 146)
# baseline: plain webview, default UA  -> Turnstile PASSES
npm start
# strip the Electron token from the UA -> Turnstile FAILS (600010 loop)
REPRO_UA=modified npm start
```

Toggles (each adds one thing T3 Code's preview does, on top of a plain webview):

Each mode below was re-run with a **fresh `--user-data-dir`** so a cached
`cf_clearance` cookie can't leak between runs.

| env | resulting UA | Turnstile |
| --- | --- | --- |
| _(none)_ | native: `… <app>/0.0.0 Chrome/146.0.7680.216 Electron/41.5.0 Safari/537.36` | **passes** |
| `REPRO_UA=noop` | native, re-set unchanged via setUserAgent | **passes** |
| `REPRO_UA=modified` | Electron token stripped | **fails (600010)** |
| `REPRO_UA=appstrip` | app token stripped, Electron kept | **fails (600010)** |
| `REPRO_PERMS=grant` | pre-grants notifications/geolocation/clipboard | passes |
| `REPRO_MODE=browser` | `BrowserWindow` instead of `<webview>` | passes |

`noop` passing while `modified`/`appstrip` fail is the key result: it is the UA
string diverging from `navigator.userAgentData`, not `setUserAgent` itself.

Observed on Ubuntu, Electron 41.5.0 / Chromium 146, against
`https://dash.cloudflare.com/login`.

## Fix for T3 Code

Stop rewriting the preview User-Agent in
`apps/desktop/src/preview/BrowserSession.ts` (the `getUserAgent()` →
`replace(/Electron\/…/)` → `setUserAgent()` block). The native Electron UA is
self-consistent with the Client Hints and passes Turnstile; the rewrite — which
only changes the UA string and never the Client Hints — is what breaks it. If
hiding the app/Electron identity is still wanted, it must be done by overriding
`userAgentMetadata` together with the UA (CDP `Network.setUserAgentOverride`),
not by `session.setUserAgent()` alone.
