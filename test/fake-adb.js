#!/usr/bin/env node
// A pretend Fire Stick for the tests: answers the adb commands the app sends
// and keeps its state (installed/disabled packages, files, settings) in the
// folder named by FAKE_ADB_STATE, so the app can be tested without a stick.
'use strict';

const fs = require('fs');
const path = require('path');

const stateDir = process.env.FAKE_ADB_STATE;
if (!stateDir) { console.error('FAKE_ADB_STATE not set'); process.exit(2); }
const stateFile = path.join(stateDir, 'state.json');

const DEFAULT = {
  installed: [
    'com.amazon.tv.launcher', 'com.amazon.venezia', 'com.amazon.tv.settings', 'com.android.systemui',
    'com.amazon.kso', 'com.amazon.device.crashmanager', 'com.amazon.dp.logger', 'com.amazon.alexashopping',
    'com.amazon.wifilocker', 'com.amazon.tv.csapp',
    'com.amazon.amazonvideo.livingroom', 'com.amazon.imdb.tv.android.app', 'com.amazon.bueller.music',
    'com.amazon.bueller.photos', 'com.amazon.cloud9',
    'com.netflix.ninja', 'com.amazon.firetv.youtube', 'com.amazon.somebackgroundservice', 'org.xbmc.kodi',
    // Fire OS 8 extras
    'com.amazon.imp', 'com.amazon.kso.blackbird', 'com.amazon.sneakpeek', 'com.amazon.tv.acr', 'com.amazon.tahoe', 'com.amazon.tv.alexaalerts',
  ],
  thirdParty: ['com.netflix.ninja', 'com.amazon.firetv.youtube', 'com.amazon.somebackgroundservice', 'org.xbmc.kodi'],
  disabled: [],
  files: {},
  settings: { 'global/device_name': 'Living Room Fire TV', 'secure/enabled_accessibility_services': 'null', 'secure/accessibility_enabled': '0' },
  authorized: true,
  log: [],
};

function load() { return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : structuredClone(DEFAULT); }
function save(s) { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); }

const args = process.argv.slice(2);
const s = load();
s.log.push(args.join(' '));
let out = '';

function shell(cmd) {
  const c = cmd.trim();
  let m;
  if (c === 'settings get global device_name') return `${s.settings['global/device_name']}\n`;
  if ((m = c.match(/^settings get (\w+) (\S+)$/))) return `${s.settings[`${m[1]}/${m[2]}`] ?? 'null'}\n`;
  if ((m = c.match(/^settings put (\w+) (\S+) '?([^']*)'?$/))) { s.settings[`${m[1]}/${m[2]}`] = m[3]; return ''; }
  if (c === 'getprop ro.serialno') return 'G070VM1234567890\n';
  if (c === 'getprop ro.build.version.release') return '11\n';
  if (c === 'getprop ro.build.version.sdk') return '30\n';
  if (c === 'getprop ro.product.cpu.abilist') return 'arm64-v8a,armeabi-v7a,armeabi\n';
  if (c === 'pm list packages') return s.installed.map((p) => `package:${p}`).join('\n') + '\n';
  if (c === 'pm list packages -d') return s.disabled.map((p) => `package:${p}`).join('\n') + '\n';
  if (c === 'pm list packages -3') return s.thirdParty.filter((p) => s.installed.includes(p)).map((p) => `package:${p}`).join('\n') + '\n';
  if ((m = c.match(/^pm disable-user --user 0 (\S+)$/))) {
    // Pretend Fire OS refuses disable-user for kso (so the fallback is exercised).
    if (m[1] === 'com.amazon.kso' || m[1] === 'com.amazon.tv.csapp') return 'Error: java.lang.SecurityException: Cannot disable a protected package\n';
    if (!s.installed.includes(m[1])) return `Error: ${m[1]} not found\n`;
    if (!s.disabled.includes(m[1])) s.disabled.push(m[1]);
    return `Package ${m[1]} new state: disabled\n`;
  }
  if ((m = c.match(/^pm uninstall -k --user 0 (\S+)$/))) {
    if (m[1] === 'com.amazon.tv.csapp') return 'Failure [DELETE_FAILED_INTERNAL_ERROR]\n';
    s.installed = s.installed.filter((p) => p !== m[1]);
    return 'Success\n';
  }
  if ((m = c.match(/^pm uninstall (\S+)$/))) { s.installed = s.installed.filter((p) => p !== m[1]); return 'Success\n'; }
  if ((m = c.match(/^cmd package install-existing --user 0 (\S+)$/))) {
    if (!s.installed.includes(m[1]) && (DEFAULT.installed.includes(m[1]) || m[1] === 'com.spocky.projengmenu')) s.installed.push(m[1]);
    return `Package ${m[1]} installed for user: 0\n`;
  }
  if ((m = c.match(/^pm enable --user 0 (\S+)$/))) { s.disabled = s.disabled.filter((p) => p !== m[1]); return `Package ${m[1]} new state: enabled\n`; }
  if ((m = c.match(/^pm grant /))) return '';
  if ((m = c.match(/^\[ -f (\S+) \] && echo yes$/))) return s.files[m[1]] !== undefined ? 'yes\n' : '';
  if ((m = c.match(/^cat (\S+)( 2>\/dev\/null)?$/))) return s.files[m[1]] !== undefined ? s.files[m[1]] : '';
  if ((m = c.match(/^mkdir -p (\S+)$/))) return '';
  if ((m = c.match(/^mkdir -p \S+ && echo (\S+) > (\S+)$/))) { s.files[m[2]] = `${m[1]}\n`; return ''; }
  if ((m = c.match(/^rm -r?f (\S+)$/))) { delete s.files[m[1]]; return ''; }
  if ((m = c.match(/^dumpsys package (\S+)$/))) {
    if (m[1] === 'com.spocky.projengmenu' && s.installed.includes(m[1])) {
      return 'Service Resolver Table:\n  Non-Data Actions:\n      android.accessibilityservice.AccessibilityService:\n        a1b2c3d com.spocky.projengmenu/.service.PAccessibilityService filter 9f8e7d6\n';
    }
    if (m[1] === 'io.github.toolicious.homeonfire' && s.installed.includes(m[1])) {
      return '      android.accessibilityservice.AccessibilityService:\n        1234abc io.github.toolicious.homeonfire/.HomeAccessibilityService filter 5678def\n';
    }
    return `Unable to find package: ${m[1]}\n`;
  }
  if (/^monkey -p /.test(c)) return 'Events injected: 1\n';
  if (/^am start /.test(c)) return 'Starting: Intent\n';
  return `/system/bin/sh: ${c.split(' ')[0]}: not found\n`;
}

const i = args[0] === '-s' ? 2 : 0;
const cmd = args[i];
if (cmd === 'connect') out = s.authorized ? `connected to ${args[i + 1]}\n` : `failed to authenticate to ${args[i + 1]}\n`;
else if (cmd === 'disconnect') out = `disconnected ${args[i + 1]}\n`;
else if (cmd === 'get-state') out = s.authorized ? 'device\n' : 'error: device unauthorized\n';
else if (cmd === 'shell') out = shell(args.slice(i + 1).join(' '));
else if (cmd === 'push') { s.files[args[i + 2]] = fs.readFileSync(args[i + 1], 'utf8'); out = '1 file pushed\n'; }
else if (cmd === 'install' || cmd === 'install-multiple') {
  const file = args[args.length - 1];
  if (/older-sdk/.test(file)) out = 'Failure [INSTALL_FAILED_OLDER_SDK]\n';
  else {
    const pkg = /home-on-fire/.test(file) ? 'io.github.toolicious.homeonfire' : 'com.spocky.projengmenu';
    if (!s.installed.includes(pkg)) s.installed.push(pkg);
    if (!s.thirdParty.includes(pkg)) s.thirdParty.push(pkg);
    out = 'Performing Streamed Install\nSuccess\n';
  }
} else if (cmd === 'reboot') { s.rebooted = (s.rebooted || 0) + 1; out = ''; }
else out = `adb: unknown command ${cmd}\n`;

save(s);
process.stdout.write(out);
