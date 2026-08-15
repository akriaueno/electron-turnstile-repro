# electron-turnstile-repro

Minimal Electron reproduction for **Cloudflare Turnstile error 600010** looping
inside an embedded `<webview>` (the failure seen in T3 Code preview,
[pingdotgg/t3code#5002](https://github.com/pingdotgg/t3code/issues/5002)).

## TL;DR — root cause

Turnstile loops with error 600010 **only when the `Electron/<version>` token is
stripped from the User-Agent string.** A plain Electron `<webview>` — even with
the default Electron UA that still contains `Electron/41.5.0` — passes Turnstile
fine.

Stripping `Electron/…` leaves a UA that claims to be Chrome
(`… Chrome/146.0.7680.216 Safari/537.36`) while `navigator.userAgentData` still
reports only `Chromium` (no `Google Chrome` brand, because it is Electron).
Turnstile treats that Chrome-string-vs-Chromium-brands inconsistency as a spoofed
browser and fails its integrity check, recreating the challenge every few
seconds. Keeping the honest `Electron/…` token makes the identity self-consistent
and Turnstile accepts it.

This is self-inflicted by the UA rewrite; it is **not** intrinsic to Electron
webviews, not WebGL/GPU, not the IP, not CDP/DevTools, not the preload, and not
the granted-permission handlers (all ruled out — see below).

## Run it

```bash
npm install            # installs electron@41.5.0 (Chromium 146)
# baseline: plain webview, default UA  -> Turnstile PASSES
npm start
# strip the Electron token from the UA -> Turnstile FAILS (600010 loop)
REPRO_UA=modified npm start
```

Toggles (each adds one thing T3 Code's preview does, on top of a plain webview):

| env | what it does | Turnstile result |
| --- | --- | --- |
| _(none)_ | plain `<webview>`, default Electron UA | **passes** |
| `REPRO_PERMS=grant` | pre-grants notifications/geolocation/clipboard | passes |
| `REPRO_UA=modified` | strips `Electron/…` from the UA | **fails (600010)** |
| `REPRO_MODE=browser` | loads the URL in a `BrowserWindow` instead of a `<webview>` | passes |

Observed on Ubuntu, Electron 41.5.0 / Chromium 146, against
`https://dash.cloudflare.com/login`.

## Fix for T3 Code

Do not strip the `Electron/<version>` token from the preview User-Agent in
`apps/desktop/src/preview/BrowserSession.ts`. Keeping it makes the UA consistent
with the Client Hints Electron actually reports. The app product token may still
be removed for privacy; only the Electron token matters for Turnstile.
