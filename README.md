# Samsung TV Web Remote

Mobile web remote for Samsung Tizen smart TVs (2016+). A small Node bridge runs on your LAN, serves the app, and talks to the TV over its WebSocket API (port 8002).

## Run

```bash
npm install
npm start
```

Open `http://<this-computer-LAN-IP>:8080` on your phone (same Wi‑Fi as TV). Add to Home Screen for full-screen app.

1. Settings → enter TV IP (TV: Settings → General → Network → Network Status → IP Settings).
2. Tap **Save & pair** → choose **Allow** on the TV.
3. Pairing token stored in `config.json` (git-ignored).

For Wake-on-LAN: enable TV *Settings → General → Network → Expert Settings → Power On with Mobile*, and set MAC.

## Features
D-pad, volume/channel hold-to-repeat, power, playback, color keys, numeric keypad, 12+ extra keys, custom `KEY_*` sender, swipe touchpad, text input to TV, open URL in TV browser, app launcher, Wake-on-LAN, live device info, haptics, PWA.

## Scrolling web pages & documents
- **Touch tab → Mode: Mouse** — drag on pad moves on-screen cursor (TV browser), tap = click.
- **Page ▲ / Page ▼** — scroll one screen (CH up/down, which Tizen browser maps to page scroll). Hold to keep scrolling.
- **Line ▲ / ▼** or swipe mode — fine scroll / move focus.
- **Open URL** field — launch any page straight in TV browser.
