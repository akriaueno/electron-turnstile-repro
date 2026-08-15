// Minimal reproduction for Cloudflare Turnstile error 600010.
//
// Baseline (no env vars): a bare <webview> loading the Cloudflare login page.
// This PASSES Turnstile, which proves the failure in T3 Code is NOT intrinsic
// to Electron <webview>. The toggles below add, one at a time, the things
// T3 Code's preview does on top of a plain webview, to find which one Turnstile
// rejects.
//
// REPRO_MODE=webview (default) | browser
// REPRO_PERMS=grant      -> install permission handlers that pre-grant
//                           notifications/geolocation/clipboard (like T3 Code),
//                           which makes navigator.permissions.query return
//                           "granted" instead of the normal "prompt".
// REPRO_UA=modified      -> strip "Electron/x" from the UA and append a custom
//                           product token, like T3 Code's BrowserSession does.
// REPRO_PARTITION=custom -> put the webview session in a persistent partition.
// REPRO_SCHEMES=custom   -> register a custom privileged URL scheme app-wide.
//
// Run: REPRO_PERMS=grant electron .

const { app, BrowserWindow, session, protocol } = require("electron");
const path = require("path");

const MODE = process.env.REPRO_MODE || "webview";
const TARGET_URL = process.env.REPRO_URL || "https://dash.cloudflare.com/login";
const PARTITION = process.env.REPRO_PARTITION === "custom" ? "persist:repro-preview" : null;

const GRANTED_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "notifications",
  "geolocation",
  "fullscreen",
  "pointerLock",
]);

app.commandLine.appendSwitch("no-sandbox");

if (process.env.REPRO_SCHEMES === "custom") {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "t3code",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

function configureSession(ses) {
  if (process.env.REPRO_UA === "modified") {
    // Reproduce T3 Code's current (broken) behaviour: strip the Electron token.
    const ua = ses.getUserAgent().replace(/Electron\/[\d.]+ /, "");
    ses.setUserAgent(ua);
  }
  if (process.env.REPRO_UA === "noop") {
    // Call setUserAgent with the UA UNCHANGED. If Turnstile fails here too, the
    // override call itself (which drops/mismatches Client Hints) is the trigger,
    // not the string content.
    ses.setUserAgent(ses.getUserAgent());
  }
  if (process.env.REPRO_UA === "appstrip") {
    // Proposed fix: strip only the app product token that sits before "Chrome/",
    // KEEP the Electron token so the UA stays consistent with the Client Hints.
    const ua = ses.getUserAgent().replace(/\s\S+\/\S+(?=\sChrome\/)/, "");
    ses.setUserAgent(ua);
  }
  if (process.env.REPRO_PERMS === "grant") {
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(GRANTED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => GRANTED_PERMISSIONS.has(permission));
  }
}

app.whenReady().then(() => {
  // The webview's guest session is what needs configuring. Configure both the
  // default session and (if used) the custom partition session.
  configureSession(session.defaultSession);
  if (PARTITION) configureSession(session.fromPartition(PARTITION));
  console.error("FINAL_UA:", JSON.stringify(session.defaultSession.getUserAgent()));

  const win = new BrowserWindow({
    width: 1000,
    height: 950,
    webPreferences: {
      webviewTag: MODE === "webview",
    },
  });

  if (MODE === "browser") {
    win.loadURL(TARGET_URL);
  } else {
    win.loadFile(path.join(__dirname, "index.html"), {
      query: {
        ...(PARTITION ? { partition: PARTITION } : {}),
        ...(process.env.REPRO_URL ? { src: process.env.REPRO_URL } : {}),
      },
    });
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
