// Drives the real app window through the guided setup against the pretend
// Fire Stick (fake-adb.js) and saves a screenshot of every step.
// Usage: node test/e2e.js <screenshot-dir>
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const shots = process.argv[2] || path.join(os.tmpdir(), 'fsd-shots');
fs.mkdirSync(shots, { recursive: true });

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-e2e-'));
  const bin = path.join(tmp, 'bin');
  const stateDir = path.join(tmp, 'stick');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(bin);
  // A fake "adb" on PATH that forwards to the pretend stick.
  fs.writeFileSync(path.join(bin, 'adb'), `#!/bin/sh\nFAKE_ADB_STATE="${stateDir}" exec "${process.execPath}" "${path.join(__dirname, 'fake-adb.js')}" "$@"\n`, { mode: 0o755 });

  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules', 'electron')),
    args: [root, '--no-sandbox'],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FSD_DATA_DIR: dataDir, LANG: 'de_DE.UTF-8' },
  });
  const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[renderer ${m.type()}] ${m.text()}`); });
  win.on('pageerror', (e) => console.log(`[renderer pageerror] ${e.message}`));
  process.on('unhandledRejection', async (e) => {
    try { await win.screenshot({ path: path.join(shots, '99-failure.png') }); } catch { /* window gone */ }
    console.error(e); process.exit(1);
  });
  await win.waitForLoadState('domcontentloaded');
  let n = 0;
  const shot = async (name) => { n++; await win.screenshot({ path: path.join(shots, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const expectText = async (text) => { await win.locator('.screen:not(.hidden)').getByText(text, { exact: false }).first().waitFor({ timeout: 15000 }); };

  // 1 welcome (German, because LANG is de)
  await expectText('Mach deinen Fire Stick schnell');
  await shot('welcome');
  await win.getByRole('button', { name: "Los geht's" }).click();

  // 2 adb: found on PATH, auto-advances to prepare
  await expectText('ADB-Debugging einschalten');
  await shot('prepare');
  await win.getByRole('button', { name: 'Erledigt, Fire Stick suchen', exact: true }).click();

  // 3 connect: the network search finds nothing here, so type the IP
  await expectText('Verbindung zum Fire Stick');
  await win.waitForTimeout(500);
  await shot('connect-searching');
  await win.locator('input[type=text]').fill('192.168.1.23');
  await win.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expectText('Verbunden mit Living Room Fire TV');
  await shot('connected');

  // 4 TV settings
  await expectText('Werbung in den Fire-Stick-Einstellungen abschalten');
  await shot('tv-settings');
  await win.getByRole('button', { name: 'Erledigt, weiter', exact: true }).click();

  // 5 cleanup: tick Freevee and Netflix, keep Prime Video
  await expectText('Werbung, Tracking und ungenutzte Apps entfernen');
  await expectText('com.amazon.kso');
  await win.locator('label.check', { hasText: 'Freevee' }).locator('input').check();
  await win.locator('label.check', { hasText: 'Netflix' }).locator('input').check();
  await shot('cleanup-choose');
  await win.getByRole('button', { name: 'Jetzt aufräumen', exact: true }).click();
  await expectText('Aufräumen abgeschlossen');
  await shot('cleanup-done');
  await win.getByRole('button', { name: 'Weiter', exact: true }).click();

  // 6 launcher choice
  await expectText('Wähle deinen Startbildschirm');
  await shot('launcher-choice');
  await win.getByRole('button', { name: 'Mit dieser Wahl weiter', exact: true }).click();

  // 7 projectivy setup: download page (skipped here), install, open, enable
  await expectText('Projectivy Launcher einrichten');
  await shot('projectivy-setup');
  // The file picker can't be driven here, so install through the pretend stick directly,
  // then use the app's own buttons for opening and enabling.
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'));
  state.installed.push('com.spocky.projengmenu');
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(state));
  await win.getByRole('button', { name: 'Projectivy am Fernseher öffnen', exact: true }).click();
  await expectText('Projectivy sollte jetzt am Fernseher offen sein');
  await win.getByRole('button', { name: 'Projectivy zu meinem Startbildschirm machen', exact: true }).click();
  await expectText('Geschafft! Drücke Home');
  await shot('projectivy-enabled');
  await win.getByRole('button', { name: 'Weiter', exact: true }).click();

  // 8 finish
  await expectText('Alles erledigt');
  await shot('finish');

  // Tools screen: preview, undo
  await win.getByRole('button', { name: 'Alle Werkzeuge öffnen', exact: true }).click();
  await expectText('Zeigt, was ein Aufräumen tun würde');
  await shot('tools-preview');
  await win.locator('.nav[data-panel=undo]').click();
  await expectText('Holt jede App zurück');
  await shot('tools-undo');
  await win.locator('.nav[data-panel=reapply]').click();
  await win.getByRole('button', { name: 'Jetzt erneut anwenden', exact: true }).click();
  await expectText('Apps aus deinem Aufräumen sind noch aus');
  await shot('tools-reapply');

  // English toggle
  await win.locator('#langEn').click();
  await expectText('Re-apply my cleanup');
  await shot('tools-english');

  // Restart from the tools screen: the session dies with the reboot, so the
  // app must go back to the connect step instead of staying in the tools.
  await win.locator('.nav[data-panel=cleanup]').click();
  await win.getByRole('button', { name: 'Clean up now', exact: true }).click();
  await win.getByRole('button', { name: 'Restart now', exact: true }).click();
  await expectText('Restarting. Give it about a minute');
  await shot('after-reboot');
  const rebootedOk = await win.locator('#screen-wizard').isVisible() && await win.locator('#stickBadge').isHidden();

  const final = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'));
  const checks = {
    freeveeOff: final.disabled.includes('com.amazon.imdb.tv.android.app'),
    netflixOff: final.disabled.includes('com.netflix.ninja'),
    primeKept: final.installed.includes('com.amazon.amazonvideo.livingroom') && !final.disabled.includes('com.amazon.amazonvideo.livingroom'),
    ksoGone: !final.installed.includes('com.amazon.kso'),
    extendedDefaultOff: final.disabled.includes('com.amazon.kso.blackbird') && final.disabled.includes('com.amazon.sneakpeek'),
    optionalKept: !final.disabled.includes('com.amazon.tahoe'),
    impKept: final.installed.includes('com.amazon.imp') && !final.disabled.includes('com.amazon.imp'),
    homeService: final.settings['secure/enabled_accessibility_services'] === 'com.spocky.projengmenu/.service.PAccessibilityService',
    listOnStick: Boolean(final.files['/sdcard/fire-stick-debloat/removed.txt']),
    listOnMac: fs.existsSync(path.join(dataDir, 'removed-G070VM1234567890.txt')),
    runLog: fs.readdirSync(path.join(dataDir, 'logs')).some((f) => f.startsWith('run-')),
    rebooted: final.rebooted === 1 && rebootedOk,
  };
  console.log(JSON.stringify(checks, null, 2));
  await app.close();
  if (!Object.values(checks).every(Boolean)) { console.error('E2E FAILED'); process.exit(1); }
  console.log(`E2E OK, screenshots in ${shots}`);
}

main().catch((e) => { throw e; });
