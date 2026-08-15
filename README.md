# electron-turnstile-repro

Minimal Electron reproduction for **Cloudflare Turnstile error 600010** looping
inside an embedded `<webview>` (the failure seen in T3 Code preview,
[pingdotgg/t3code#5002](https://github.com/pingdotgg/t3code/issues/5002)).

## TL;DR — observation

Turnstile loops with error 600010 whenever the guest's User-Agent string is
**rewritten to anything other than the native Electron UA**. A plain Electron
`<webview>` with its untouched UA passes. This is a controlled single-variable
experiment: instrumentation (see below) shows that across all modes the
JS-visible `navigator.userAgentData` is identical and no `Sec-CH-UA` request
headers are sent at all, so **the UA string is the only thing that changes —
and it alone flips the outcome**.

Measured on Ubuntu, Electron 41.5.0 / Chromium 146, each mode in a fresh
`--user-data-dir`, against `https://dash.cloudflare.com/login`:

| Mode | UA header = `navigator.userAgent` (always agree) | Turnstile |
| --- | --- | --- |
| _(none)_ native | `… <app>/0.0.0 Chrome/146.0.7680.216 Electron/41.5.0 Safari/537.36` | **passes** |
| `REPRO_UA=noop` re-set unchanged via `setUserAgent()` | same string as native | **passes** |
| `REPRO_UA=appstrip` app token stripped, Electron kept | `… Chrome/146.0.7680.216 Electron/41.5.0 Safari/537.36` | **fails (600010 loop)** |
| `REPRO_UA=modified` Electron token stripped | `… <app>/0.0.0 Chrome/146.0.7680.216 Safari/537.36` | **fails (600010 loop)** |

Constant across all four modes (dumped from the guest and from
`https://httpbin.org/headers`):

- `navigator.userAgentData.brands`: `Not-A.Brand 24`, `Chromium 146` (no
  `Google Chrome`, no Electron), platform `Linux`, fullVersionList
  `Chromium 146.0.7680.216`.
- Request headers contain **no** `Sec-CH-UA*` headers at all (Electron 41
  `<webview>` default), so the server sees no Client-Hints signal either way.
- The `User-Agent` request header and `navigator.userAgent` always agree.

`noop` passing while `appstrip`/`modified` fail rules out the
`setUserAgent()` call itself; only the string content matters — and no single
token is the trigger, since keeping the honest `Electron/…` token
(`appstrip`) still fails.

Turnstile is a closed system, so the exact discriminator is not observable
from outside. A plausible reading is that it validates the UA string against
its own fingerprint of the real browser environment and accepts the exact
native pattern while rejecting hand-edited variants — but the repro only
proves the *what*, not the *why*. The actionable conclusion is: **do not
rewrite the UA string** (or, if an identity change is truly needed, override
`userAgentMetadata` together with the UA via CDP
`Network.setUserAgentOverride`, which keeps every layer consistent).

Also ruled out as causes (toggles below): pre-granted permission handlers,
`BrowserWindow` vs `<webview>`, and — in the T3 Code investigation — CDP
debugger attachment, the preview preload / `contextIsolation`, and WebGL/GPU
state.

## Run it

```bash
npm install            # installs electron@41.5.0 (Chromium 146)
# baseline: plain webview, native UA          -> Turnstile PASSES
npm start
# strip the Electron token                    -> FAILS (600010 loop)
REPRO_UA=modified npm start
# strip only the app token, keep Electron/…  -> FAILS (600010 loop)
REPRO_UA=appstrip npm start
# re-set the UNCHANGED native string          -> PASSES
REPRO_UA=noop npm start
```

Other toggles: `REPRO_PERMS=grant` (pre-grant notifications/geolocation/
clipboard — passes), `REPRO_MODE=browser` (BrowserWindow instead of webview —
passes), `REPRO_URL=…` (point the guest elsewhere, e.g.
`https://httpbin.org/headers` to see exactly which headers are sent). The
host page shows a live dump of the guest's `navigator.userAgent` /
`navigator.userAgentData` under the webview.

## Fix for T3 Code

Stop rewriting the preview User-Agent in
`apps/desktop/src/preview/BrowserSession.ts` (the `getUserAgent()` →
`replace(/Electron\/…/)` → `setUserAgent()` block). The native Electron UA
passes Turnstile; every rewritten variant tested does not.
