# Debloat for Fire TV (Mac)

A Mac app that removes ads and tracking from a Fire TV Stick, lets you keep only the apps you use, and sets up a clean, fast home screen (Projectivy Launcher). It walks you through everything step by step and tells you what to do on the TV at the same time.

It is the Mac equivalent of the Windows tool [cmeraspro-dev/Fire-Stick-Debloat](https://github.com/cmeraspro-dev/Fire-Stick-Debloat): same package lists, same protection rules, same per-stick undo list. Apps are disabled, never deleted. Everything can be undone with one click.

Independent open-source project. Not affiliated with, endorsed or sponsored by Amazon. Fire TV and Fire TV Stick are trademarks of Amazon.com, Inc. or its affiliates, used here only to describe which devices the app works with. The app changes system settings on your own device through Amazon's official ADB developer interface; use it at your own risk. If something goes wrong, a factory reset of the stick is the fallback.

*Deutsch: Die App ist zweisprachig (Deutsch/Englisch) und wählt die Sprache automatisch. Anleitung auf Deutsch weiter unten.*

## What it does

- **Guided setup** (the main screen): welcome → helper tool → prepare the stick → connect → ads in the Fire TV settings → remove ads & apps → choose a home screen → set it up → finish. Every step says what to do on the Mac and what to do on the TV with the remote.
- **Remove ads and tracking** automatically: sponsored home-screen ads, usage logging, crash reports, Alexa shopping prompts, the Wi-Fi password uploader.
- **Remove apps you choose**: Amazon apps (Prime Video, Freevee, Music, Photos, Silk) and apps you installed, each with a checkbox.
- **Home screen**: Projectivy Launcher (recommended), any other launcher via Home on Fire, or keep Amazon's.
- **All tools**: preview, clean up, undo everything, launcher, install an .apk/.apkm from the Mac, uninstall an app, get Projectivy, re-apply after a Fire OS update, switch stick, open log files.
- **Never touched**: the system home screen, Appstore, settings, remote and Alexa, casting.

## Download and run

1. Download the newest `Debloat.for.Fire.TV-<version>-universal.dmg` from the [Releases page](https://github.com/monsieurfux/fire-stick-debloat-mac/releases/latest) (built automatically by GitHub Actions on every tagged release), open it and drag the app to Applications. The universal build runs on Intel and Apple Silicon Macs.
2. The app is not signed with an Apple developer certificate. The first time, **right-click the app → Open → Open** (or allow it under System Settings → Privacy & Security).
3. Follow the steps in the app.

On first run the app offers to download Google's free Android platform-tools (adb, a few MB) into its own folder. Google's license does not allow shipping adb inside the app. If you already have adb (Homebrew, Android Studio), it is used instead.

## Supported sticks

- Fire OS 8 (Android 11, e.g. Fire TV Stick 4K Max, 4K 2nd gen): tested with Projectivy by the Windows tool's author.
- Fire OS 7 (Android 9): expected to work.
- Fire OS 6 (Android 7.1, e.g. Fire TV Stick 4K 1st gen): cleanup, undo and re-apply work; Projectivy may not be able to take over the Home button.
- Fire OS 5 (Fire TV Stick 1st/2nd gen): cleanup works, Projectivy cannot be installed.
- Vega OS (newest sticks such as 4K Select): not supported.

## Run from source

```
git clone https://github.com/monsieurfux/fire-stick-debloat-mac.git
cd fire-stick-debloat-mac
npm install
npm start
```

## Build the .dmg yourself

```
npm run dist        # creates dist/Debloat for Fire TV-<version>-universal.dmg and .zip
```

Building needs a Mac. The GitHub workflow in `.github/workflows/build-mac.yml` does the same on a macOS runner and attaches the files to a release when you push a tag like `v1.0.0`.

## Tests

```
npm test                                   # core logic against a pretend Fire Stick (test/fake-adb.js)
node test/e2e.js /tmp/shots                # clicks through the whole guided setup in the real window
```

The end-to-end test needs Playwright (`npm i -D playwright`) and, on Linux, `xvfb-run`.

## Where things are kept

- App data (adb, per-stick lists of removed apps, logs): `~/Library/Application Support/Debloat for Fire TV/`
- `removed-<serial>.txt`: what was removed on that stick, with a backup copy on the stick at `/sdcard/fire-stick-debloat/removed.txt`, so Undo and Re-apply work from any Mac.
- `logs/run-<date>.txt`: the newest 10 runs, for bug reports.

## Project layout

- `src/main.js`: Electron main process, IPC, file dialogs, downloads.
- `src/core/stick.js`: everything done to the stick, ported from `FireStick.ps1`.
- `src/core/adb.js`: finding/downloading adb and running it.
- `src/core/discovery.js`: finding sticks on the local network (port 5555).
- `src/renderer/`: the window (guided setup + tools), `strings.js` holds all text in EN and DE.
- `test/`: fake stick, unit tests, end-to-end test.

---

## Anleitung (Deutsch)

**Was du brauchst:** den Mac und den Fire Stick im selben WLAN, die Fernbedienung, etwa 20 Minuten.

1. `.dmg` von der [Releases-Seite](https://github.com/monsieurfux/fire-stick-debloat-mac/releases/latest) laden, öffnen, App in „Programme“ ziehen.
2. Beim ersten Start **Rechtsklick auf die App → Öffnen → Öffnen** (die App ist nicht von Apple signiert).
3. Der App folgen. Sie führt dich durch:
   - Hilfsprogramm (adb) einmalig herunterladen,
   - am Fernseher Entwickleroptionen und ADB-Debugging einschalten,
   - verbinden (der Stick wird im WLAN gesucht, am Fernseher „Immer zulassen“ bestätigen),
   - am Fernseher Autoplay und Werbe-Einstellungen abschalten,
   - Werbung und Tracking entfernen, Apps per Häkchen auswählen,
   - Startbildschirm wählen (Projectivy empfohlen) und einrichten,
   - Neustart.
4. Nach einem Fire-OS-Update: „Alle Werkzeuge“ → „Erneut anwenden“. Rückgängig: „Alle Werkzeuge“ → „Alles rückgängig“.
