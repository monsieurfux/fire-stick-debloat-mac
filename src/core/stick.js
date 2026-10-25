// Everything the app does to a Fire Stick, ported line by line from the
// Windows tool (FireStick.ps1). Apps are disabled, never deleted. Everything
// removed is written to removed-<serial>.txt (and backed up on the stick) so
// Undo and Re-apply keep working after a Fire OS update or on another Mac.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { unzip } = require('./adb');

// Ads, tracking and background junk. Removed without asking.
const ADS_TELEMETRY = [
  'com.amazon.kso', // "Special offers": sponsored ads on the home screen
  'com.amazon.device.crashmanager', // crash reports sent to Amazon
  'com.amazon.dp.logger', // usage logging
  'com.amazon.alexashopping', // Alexa shopping prompts
  'com.amazon.ags.app', // GameCircle
  'com.amazon.wifilocker', // uploads your Wi-Fi passwords to Amazon
  'com.amazon.tv.csapp', // customer service promo app
  'com.amazon.tv.legal.notices', // legal notices viewer
];

// More ads, promos and telemetry, mostly Fire OS 7/8 packages. Ticked by
// default in the cleanup list, but each one can be unticked. From the
// CleanYourTV lists for the Fire TV Stick 4K (2023, Fire OS 8.1.8.5) and
// 4K Max (2021, Fire OS 7), which were applied and reboot-tested there.
const EXTENDED_ADS_TELEMETRY = [
  'com.amazon.kso.blackbird', // launcher ad sync / bidding (sponsored banner and rows)
  'com.amazon.sneakpeek', // sponsored "Sneak Peek" previews
  'com.amazon.hybridadidservice', // advertising ID service
  'com.amazon.media.recommendations', // recommendation feed
  'com.amazon.providers.contentsupport', // content support provider
  'com.amazon.tv.easyupgrade', // "upgrade your Fire TV" promos
  'com.amazon.shoptv.client', // Amazon Shopping on TV
  'com.amazon.shoptv.firetv.client',
  'com.amazon.hedwig', // Fire TV Channels row
  'com.amazon.tv.livetv', // Live tab and guide (no tuner on a stick)
  'com.amazon.franktvinput', // live TV input feeding the Live tab
  'com.amazon.systemnotices', // system notices
  'com.amazon.tv.releasenotes', // "what's new" popups
  'com.amazon.uxnotification', // UX notification popups
  'com.amazon.tv.earlyaccess', // early-access / preview program stub
  'com.amazon.tv.acr', // automatic content recognition
  'com.amazon.ftvspatial', // presence / indoor-location sensing
  'com.amazon.client.metrics.api', // metrics
  'com.amazon.metrics.api',
  'com.amazon.neo.minerva', // metrics (Fire OS 8)
  'com.amazon.neo.minerva.logcat',
  'com.amazon.tv.fw.metrics', // metrics (Fire OS 6/7)
  'com.amazon.wirelessmetrics.service',
  'com.amazon.perfcollection', // performance data collection
  'com.amazon.perfc',
  'com.amazon.ceviche', // data collection pipelines
  'com.amazon.tv.developer.dataservice', // content personalization data for third-party apps
  'com.amazon.device.telemetry.emitter', // telemetry (Fire OS 8)
  'com.amazon.livedeviceservice',
  'com.amazon.privacypassservice', // privacy pass token service
];

// Amazon services few people use. Unticked by default; you decide.
const EXTENDED_OPTIONAL = [
  'com.amazon.tahoe', // Amazon Kids
  'com.amazon.gamehub', // Luna / Game Hub
  'com.amazon.minitv.android.app', // miniTV
  'com.amazon.tv.ftvambient', // Ambient Experience (the plain screensaver stays)
  'com.amazon.tmm.tutorial', // remote tutorial
  'com.amazon.storm.lightning.tutorial', // remote app tutorial
  'com.amazon.tv.website_launcher', // opens websites in Silk
  'com.amazon.whisperjoin.middleware.v2.np', // setup of other Amazon devices
  'com.amazon.whisperjoin.middleware.np',
  'com.amazon.tv.ffsprovisioneeclient',
  'com.amazon.ods.kindleconnect', // "show on Fire TV" from Echo / Fire tablet
  'com.amazon.tv.alexaalerts', // Alexa alarms, timers, reminders
  'com.amazon.tv.alexanotifications',
  'com.amazon.alexa.externalmediaplayer.fireos', // Alexa music playback
  'com.amazon.alexamediaplayer.runtime.ftv',
  'com.amazon.aiondec', // Alexa skill connections
  'com.amazon.firetv.androidskillconnectioncapability',
  'com.amazon.spotify.mediabrowserservice', // Spotify for Alexa (the Spotify app is separate)
  'com.amazon.audiohome', // Alexa Home Theater
  'com.amazon.whad', // whole-home audio
  'com.amazon.whasettings',
  'com.amazon.wha.mediabrowserservice',
  'com.amazon.aca', // Alexa hints / cues
  'com.amazon.rtcsessioncontroller', // Alexa calling / Drop In
  'com.amazon.smarthomemapviewapp', // smart home dashboard
  'com.amazon.tv.mattercohost', // Matter smart-home controller (Matter casting stays)
];

// Amazon apps. You're asked about each one.
const AMAZON_APPS = [
  'com.amazon.amazonvideo.livingroom',
  'com.amazon.avod.thirdpartyclient',
  'com.amazon.imdb.tv.android.app',
  'com.amazon.bueller.music',
  'com.amazon.bueller.photos',
  'com.amazon.cloud9',
];

// Never touched: removing these can break the stick (home screen, Appstore,
// settings, remote/Alexa, casting) or the tools you need for the clean look.
const PROTECTED = [
  'com.amazon.tv.launcher', 'com.amazon.venezia', 'com.amazon.tv.settings',
  'com.amazon.tv.settings.v2', 'com.amazon.vizzini', 'com.amazon.tcomm',
  'com.amazon.whisperplay', 'com.amazon.device.sync', 'com.android.systemui',
  // com.amazon.imp: with it disabled, the Fire OS 8 home screen stays black (CleanYourTV report, 4K 2023).
  'com.amazon.imp',
  'com.spocky.projengmenu', 'com.esaba.downloader', 'io.github.toolicious.homeonfire',
];

const NAMES = {
  'com.amazon.amazonvideo.livingroom': 'Prime Video',
  'com.amazon.avod.thirdpartyclient': 'Prime Video (extra copy)',
  'com.amazon.imdb.tv.android.app': 'Freevee',
  'com.amazon.bueller.music': 'Amazon Music',
  'com.amazon.bueller.photos': 'Amazon Photos (also the photo screensaver)',
  'com.amazon.cloud9': 'Silk Browser',
  'com.netflix.ninja': 'Netflix',
  'com.amazon.firetv.youtube': 'YouTube',
  'com.disney.disneyplus': 'Disney+',
  'com.hulu.plus': 'Hulu',
  'com.wbd.stream': 'Max',
  'com.cbs.ott': 'Paramount+',
  'com.peacocktv.peacockandroid': 'Peacock',
  'com.apple.atve.amazon.appletv': 'Apple TV',
  'com.spotify.tv.android': 'Spotify',
  'com.plexapp.android': 'Plex',
  'tv.pluto.android': 'Pluto TV',
  'com.tubitv': 'Tubi',
  'com.tubitv.ott': 'Tubi',
  'org.xbmc.kodi': 'Kodi',
  'com.spocky.projengmenu': 'Projectivy Launcher',
  'org.pegasus_frontend.android': 'Pegasus',
  'io.github.toolicious.homeonfire': 'Home on Fire',
  'com.seeker.tv': 'Seeker TV',
  'ar.tvplayer.tv': 'TiviMate',
  'com.hbo.hbonow': 'HBO Max',
  'com.sling': 'Sling TV',
  'com.stremio.one': 'Stremio',
  'com.tiktok.tv': 'TikTok',
  'com.koushikdutta.cast.receiver': 'AllCast Receiver',
  // extended groups
  'com.amazon.kso.blackbird': 'Home screen ad sync (sponsored banner and rows)',
  'com.amazon.sneakpeek': 'Sponsored "Sneak Peek" previews',
  'com.amazon.hybridadidservice': 'Advertising ID service',
  'com.amazon.media.recommendations': 'Recommendation feed',
  'com.amazon.providers.contentsupport': 'Content support provider (promos)',
  'com.amazon.tv.easyupgrade': '"Upgrade your Fire TV" promos',
  'com.amazon.shoptv.client': 'Amazon Shopping on TV',
  'com.amazon.shoptv.firetv.client': 'Amazon Shopping on TV (helper)',
  'com.amazon.hedwig': 'Fire TV Channels row',
  'com.amazon.tv.livetv': 'Live tab and guide',
  'com.amazon.franktvinput': 'Live TV input',
  'com.amazon.systemnotices': 'System notices',
  'com.amazon.tv.releasenotes': '"What\'s new" popups',
  'com.amazon.uxnotification': 'Notification popups',
  'com.amazon.tv.earlyaccess': 'Early-access program stub',
  'com.amazon.tv.acr': 'Automatic content recognition',
  'com.amazon.ftvspatial': 'Presence / location sensing',
  'com.amazon.client.metrics.api': 'Metrics',
  'com.amazon.metrics.api': 'Metrics',
  'com.amazon.neo.minerva': 'Metrics (Minerva)',
  'com.amazon.neo.minerva.logcat': 'Metrics (Minerva log upload)',
  'com.amazon.tv.fw.metrics': 'Metrics (firmware)',
  'com.amazon.wirelessmetrics.service': 'Wi-Fi metrics',
  'com.amazon.perfcollection': 'Performance data collection',
  'com.amazon.perfc': 'Performance data collection',
  'com.amazon.ceviche': 'Data collection pipelines',
  'com.amazon.tv.developer.dataservice': 'Personalization data for third-party apps',
  'com.amazon.device.telemetry.emitter': 'Telemetry emitter',
  'com.amazon.livedeviceservice': 'Live device service (telemetry)',
  'com.amazon.privacypassservice': 'Privacy pass token service',
  'com.amazon.tahoe': 'Amazon Kids',
  'com.amazon.gamehub': 'Luna / Game Hub',
  'com.amazon.minitv.android.app': 'miniTV',
  'com.amazon.tv.ftvambient': 'Ambient Experience (art screensaver)',
  'com.amazon.tmm.tutorial': 'Remote tutorial',
  'com.amazon.storm.lightning.tutorial': 'Remote app tutorial',
  'com.amazon.tv.website_launcher': 'Website launcher (opens sites in Silk)',
  'com.amazon.whisperjoin.middleware.v2.np': 'Setup of other Amazon devices',
  'com.amazon.whisperjoin.middleware.np': 'Setup of other Amazon devices',
  'com.amazon.tv.ffsprovisioneeclient': 'Setup of other Amazon devices (client)',
  'com.amazon.ods.kindleconnect': '"Show on Fire TV" from Echo / Fire tablet',
  'com.amazon.tv.alexaalerts': 'Alexa alarms, timers, reminders',
  'com.amazon.tv.alexanotifications': 'Alexa notifications',
  'com.amazon.alexa.externalmediaplayer.fireos': 'Alexa music playback',
  'com.amazon.alexamediaplayer.runtime.ftv': 'Alexa music playback (runtime)',
  'com.amazon.aiondec': 'Alexa skill connections',
  'com.amazon.firetv.androidskillconnectioncapability': 'Alexa skill connections (Fire OS 8)',
  'com.amazon.spotify.mediabrowserservice': 'Spotify for Alexa (the Spotify app is separate)',
  'com.amazon.audiohome': 'Alexa Home Theater',
  'com.amazon.whad': 'Whole-home audio',
  'com.amazon.whasettings': 'Whole-home audio (settings)',
  'com.amazon.wha.mediabrowserservice': 'Whole-home audio (service)',
  'com.amazon.aca': 'Alexa hints and cues',
  'com.amazon.rtcsessioncontroller': 'Alexa calling / Drop In',
  'com.amazon.smarthomemapviewapp': 'Smart home dashboard',
  'com.amazon.tv.mattercohost': 'Matter smart-home controller',
};

// Folders some apps leave behind in shared storage after they're uninstalled.
const LEFTOVERS = {
  'org.pegasus_frontend.android': '/sdcard/pegasus-frontend',
};

const PROJECTIVY_PKG = 'com.spocky.projengmenu';
const HOME_ON_FIRE_PKG = 'io.github.toolicious.homeonfire';
const HOME_ON_FIRE_APK = 'https://github.com/toolicious/home-on-fire/releases/latest/download/home-on-fire.apk';
const PROJECTIVY_PAGE = 'https://www.apkmirror.com/apk/spocky/projectivy-launcher-android-tv/';

const DEVICE_DIR = '/sdcard/fire-stick-debloat';
const DEVICE_LOG = `${DEVICE_DIR}/removed.txt`;
const LEGACY_DEVICE_LOG = `${DEVICE_DIR}/disabled.txt`;
const HOME_CHOICE_FILE = `${DEVICE_DIR}/home.txt`;

const PKG_RE = /^[A-Za-z0-9_.]+$/;

function nameOf(pkg) {
  return NAMES[pkg] ? `${NAMES[pkg]}  (${pkg})` : pkg;
}

function lines(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

// Only real "package:<name>" lines. Anything else ("error: device offline",
// "adb: ...") is adb talking, not a package.
function packagesFrom(text) {
  return lines(text).filter((l) => l.startsWith('package:')).map((l) => l.slice('package:'.length)).filter((p) => PKG_RE.test(p));
}

// Package names only; anything else in a list file is ignored, never run.
function packageLines(text) {
  return lines(text).filter((l) => PKG_RE.test(l));
}

class Stick {
  // run: (args) => Promise<string>  (adb with stdout+stderr merged)
  // dataDir: where removed-<serial>.txt lives
  // log: (message, level) => void   level: info | ok | warn | error | dim
  constructor({ run, ip, dataDir, log = () => {} }) {
    this.run = run;
    this.ip = ip;
    this.target = `${ip}:5555`;
    this.dataDir = dataDir;
    this.log = log;
    this.logFile = null;
    this.name = null;
  }

  adb(args) { return this.run(['-s', this.target, ...args]); }
  shell(cmd) { return this.adb(['shell', cmd]); }

  // --- connecting -------------------------------------------------------

  // onPrompt is called once when the TV is (probably) showing its
  // "Allow USB debugging?" box. Returns true when connected.
  async connect({ onPrompt } = {}) {
    const r = await this.run(['connect', this.target], { timeout: 40000 });
    // Success is "connected to" or "already connected to"; "failed to
    // authenticate to" is normal the first time (the TV shows its popup).
    if (!/(^|\n)\s*(already connected to|connected to|failed to authenticate to)/.test(r)) {
      return { ok: false, reason: 'unreachable', detail: r.trim() };
    }
    for (let i = 0; i < 45; i++) {
      const state = await this.adb(['get-state']);
      if (/(^|\n)device/.test(state)) {
        let name = (await this.shell('settings get global device_name')).trim();
        if (!name || name === 'null') name = 'the Fire Stick';
        this.name = name;
        return { ok: true, name };
      }
      if (i === 0 && onPrompt) onPrompt();
      if (i === 15) {
        await this.run(['disconnect', this.target]);
        await this.run(['connect', this.target], { timeout: 40000 });
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    return { ok: false, reason: 'not-authorized' };
  }

  async disconnect() { await this.run(['disconnect', this.target]); }

  // --- package lists ----------------------------------------------------

  async getInstalled() { return packagesFrom(await this.shell('pm list packages')); }
  async getDisabled() { return packagesFrom(await this.shell('pm list packages -d')); }

  // Apps you installed. Amazon's own background services are left out so
  // you're only asked about apps you'd recognise.
  async getYourApps() {
    return packagesFrom(await this.shell('pm list packages -3'))
      .filter((p) => !PROTECTED.includes(p) && !AMAZON_APPS.includes(p) && !ADS_TELEMETRY.includes(p)
        && !EXTENDED_ADS_TELEMETRY.includes(p) && !EXTENDED_OPTIONAL.includes(p))
      .filter((p) => !p.startsWith('com.amazon.') || Object.hasOwn(NAMES, p))
      .sort();
  }

  // Installed apps that aren't switched off yet: the ones a cleanup can act on.
  async getActiveApps() {
    const off = new Set(await this.getDisabled());
    return (await this.getInstalled()).filter((p) => !off.has(p));
  }

  // auto: removed without asking. asked: one tick-box each, grouped:
  // 'extended' (ticked by default), 'amazon', 'optional' and 'yours' (unticked).
  async preview() {
    const active = new Set(await this.getActiveApps());
    const auto = ADS_TELEMETRY.filter((p) => active.has(p));
    const entry = (group, on) => (p) => ({ pkg: p, name: NAMES[p] || null, group, on });
    const asked = [
      ...EXTENDED_ADS_TELEMETRY.map(entry('extended', true)),
      ...AMAZON_APPS.map(entry('amazon', false)),
      ...EXTENDED_OPTIONAL.map(entry('optional', false)),
      ...(await this.getYourApps()).map(entry('yours', false)),
    ].filter((a) => active.has(a.pkg));
    return { auto, asked };
  }

  // --- the removed list (per stick, mirrored on the stick) ---------------

  // A one-word answer from the stick, or '' if adb answered with an error.
  async idProp(cmd) {
    const v = (await this.shell(cmd)).trim();
    return /^[A-Za-z0-9_-]+$/.test(v) && v !== 'null' ? v.replace(/[^A-Za-z0-9]/g, '') : '';
  }

  async hasDeviceList() { return /yes/.test(await this.shell(`[ -f ${DEVICE_LOG} ] && echo yes`)); }

  async initRemovedList() {
    let id = await this.idProp('getprop ro.serialno');
    if (!id) id = await this.idProp('settings get secure android_id');
    if (!id) id = 'unknown';
    this.serial = id;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.logFile = path.join(this.dataDir, `removed-${id}.txt`);

    if (fs.existsSync(this.logFile) || (await this.hasDeviceList())) return;
    // The Windows tool before v1.2 kept one shared list and a copy on the
    // stick. Carry it over, keeping only apps that are actually off here.
    const legacyLocal = path.join(this.dataDir, 'disabled.txt');
    let old = [];
    if (fs.existsSync(legacyLocal)) old.push(...packageLines(fs.readFileSync(legacyLocal, 'utf8')));
    old.push(...packageLines(await this.shell(`cat ${LEGACY_DEVICE_LOG} 2>/dev/null`)));
    if (old.length === 0) return;
    const installed = new Set(await this.getInstalled());
    const off = new Set(await this.getDisabled());
    const mine = [...new Set(old)].sort().filter((p) => !(installed.has(p) && !off.has(p)));
    if (mine.length) fs.writeFileSync(this.logFile, `${mine.join('\n')}\n`);
    await this.shell(`rm -f ${LEGACY_DEVICE_LOG}`);
    if (fs.existsSync(legacyLocal)) fs.renameSync(legacyLocal, `${legacyLocal}.old`);
    this.log(`Now keeping a separate list of removed apps for each Fire Stick (${mine.length} on this one).`, 'ok');
  }

  localList() {
    if (!this.logFile || !fs.existsSync(this.logFile)) return [];
    return packageLines(fs.readFileSync(this.logFile, 'utf8'));
  }

  appendLocal(pkg) {
    fs.appendFileSync(this.logFile, `${pkg}\n`);
  }

  // Makes sure the list can be written before anything on the stick is
  // changed, so a removal is never left unrecorded.
  ensureListWritable() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.appendFileSync(this.logFile, '');
  }

  // Merges the list on this Mac with the copy on the stick, saves both.
  async syncRemovedList() {
    const device = packageLines(await this.shell(`cat ${DEVICE_LOG} 2>/dev/null`));
    const all = [...new Set([...this.localList(), ...device])].sort();
    if (all.length === 0) return [];
    fs.writeFileSync(this.logFile, `${all.join('\n')}\n`);
    await this.shell(`mkdir -p ${DEVICE_DIR}`);
    await this.adb(['push', this.logFile, DEVICE_LOG]);
    return all;
  }

  // Connect + load this stick's list. Mirrors Open-Stick.
  async open(opts) {
    const c = await this.connect(opts);
    if (!c.ok) return c;
    await this.initRemovedList();
    const hadDeviceCopy = await this.hasDeviceList();
    const localCount = this.localList().length;
    const synced = await this.syncRemovedList();
    if (synced.length > localCount) {
      this.log("Restored your list of removed apps from the Fire Stick's backup.", 'ok');
    } else if (synced.length > 0 && !hadDeviceCopy && (await this.hasDeviceList())) {
      this.log('Backed up your list of removed apps to the Fire Stick.', 'ok');
    }
    return { ok: true, name: this.name, removedCount: this.localList().length };
  }

  // --- cleanup / undo / re-apply ----------------------------------------

  async disablePkg(pkg) {
    if (PROTECTED.includes(pkg)) {
      this.log(`  skipped   ${nameOf(pkg)} (the system needs it)`, 'dim');
      return 'skipped';
    }
    // disable-user is the gentlest option; newer Fire OS blocks it for some
    // system apps, so fall back to removing it for this user (still undoable).
    let r = await this.shell(`pm disable-user --user 0 ${pkg}`);
    if (!/disabled/.test(r)) r = await this.shell(`pm uninstall -k --user 0 ${pkg}`);
    if (/disabled|Success/.test(r)) {
      this.log(`  removed   ${nameOf(pkg)}`, 'ok');
      this.appendLocal(pkg);
      return 'removed';
    }
    this.log(`  couldn't remove ${nameOf(pkg)} (Fire OS protects it; that's fine)`, 'dim');
    return 'failed';
  }

  // chosen: the packages the person ticked. Ads/telemetry go without asking.
  async cleanup(chosen) {
    this.ensureListWritable();
    const active = new Set(await this.getActiveApps());
    const results = { removed: [], failed: [], skipped: [] };
    const act = async (p) => { results[await this.disablePkg(p) === 'removed' ? 'removed' : 'failed'].push(p); };
    this.log('Removing ads and tracking...', 'info');
    for (const p of ADS_TELEMETRY) if (active.has(p)) await act(p);
    const allowed = new Set([...EXTENDED_ADS_TELEMETRY, ...AMAZON_APPS, ...EXTENDED_OPTIONAL, ...(await this.getYourApps())]);
    this.log('Removing the apps you chose...', 'info');
    for (const p of chosen) {
      if (!PKG_RE.test(p) || !allowed.has(p)) { results.skipped.push(p); continue; }
      if (active.has(p)) await act(p);
    }
    await this.syncRemovedList();
    return results;
  }

  async undo() {
    if (!this.logFile || !fs.existsSync(this.logFile)) return { restored: [] };
    this.log('Bringing everything back...', 'info');
    const restored = [];
    for (const p of [...new Set(this.localList())].sort()) {
      await this.shell(`cmd package install-existing --user 0 ${p}`);
      await this.shell(`pm enable --user 0 ${p}`);
      this.log(`  restored  ${nameOf(p)}`, 'ok');
      restored.push(p);
    }
    fs.unlinkSync(this.logFile);
    await this.shell(`rm -f ${DEVICE_LOG}`);
    return { restored };
  }

  // After a Fire OS update: turns off again anything from the last cleanup
  // that the update switched back on, and gives the launcher the Home button.
  async reapply() {
    const list = await this.syncRemovedList();
    if (list.length === 0) return { nothing: true };
    this.ensureListWritable();
    const installed = new Set(await this.getInstalled());
    const off = new Set(await this.getDisabled());
    const back = list.filter((p) => installed.has(p) && !off.has(p));
    if (back.length === 0) {
      this.log(`All ${list.length} apps from your cleanup are still off.`, 'ok');
    } else {
      this.log(`${back.length} of ${list.length} apps came back after the update. Turning them off again...`, 'info');
      for (const p of back) await this.disablePkg(p);
      await this.syncRemovedList();
    }
    const home = await this.restoreHomeChoice();
    return { total: list.length, back, home };
  }

  // --- home button / launchers -----------------------------------------

  async getAccessibilityService(pkg) {
    const dump = await this.shell(`dumpsys package ${pkg}`);
    const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let m = dump.match(new RegExp(`android\\.accessibilityservice\\.AccessibilityService:\\s*\\n\\s*\\S+\\s+(${esc}/\\S+)`));
    if (m) return m[1];
    m = dump.match(new RegExp(`(${esc}/\\S*[Aa]ccessib\\S*)`));
    return m ? m[1] : null;
  }

  // Switches on one app's Home-button service and switches off the other's,
  // so the two never fight over Home. Other accessibility services are kept.
  async setHomeService(pkg) {
    const svc = await this.getAccessibilityService(pkg);
    if (!svc) return false;
    const current = (await this.shell('settings get secure enabled_accessibility_services')).trim();
    let keep = [];
    if (current && current !== 'null') {
      keep = current.split(':').filter((s) => s && !s.startsWith(`${PROJECTIVY_PKG}/`) && !s.startsWith(`${HOME_ON_FIRE_PKG}/`));
    }
    const next = [...keep, svc].join(':');
    await this.shell(`settings put secure enabled_accessibility_services '${next}'`);
    await this.shell('settings put secure accessibility_enabled 1');
    await this.shell(`mkdir -p ${DEVICE_DIR} && echo ${pkg} > ${HOME_CHOICE_FILE}`);
    return (await this.shell('settings get secure enabled_accessibility_services')).includes(svc);
  }

  async hasProjectivy() { return (await this.getInstalled()).includes(PROJECTIVY_PKG); }
  async hasHomeOnFire() { return (await this.getInstalled()).includes(HOME_ON_FIRE_PKG); }

  async enableProjectivy() {
    if (!(await this.hasProjectivy())) return { ok: false, reason: 'not-installed' };
    if (await this.setHomeService(PROJECTIVY_PKG)) {
      this.log('Done! Press Home on your remote: you should land on Projectivy.', 'ok');
      return { ok: true };
    }
    this.log("Fire OS didn't accept the change. Use 'Override current launcher' in Projectivy's own settings instead.", 'warn');
    return { ok: false, reason: 'rejected' };
  }

  // Projectivy finishes setting itself up the first time it's opened.
  async openProjectivy() {
    const r = await this.shell(`monkey -p ${PROJECTIVY_PKG} -c android.intent.category.LEANBACK_LAUNCHER 1`);
    if (/No activities/.test(r)) await this.shell(`monkey -p ${PROJECTIVY_PKG} -c android.intent.category.LAUNCHER 1`);
  }

  // apkPath: a downloaded home-on-fire.apk, needed only if it isn't installed yet.
  async enableHomeOnFire(apkPath) {
    if (!(await this.hasHomeOnFire())) {
      if (!apkPath) return { ok: false, reason: 'not-installed' };
      const r = await this.adb(['install', '-r', apkPath]);
      if (!/Success/.test(r)) { this.log(r, 'error'); return { ok: false, reason: 'install-failed', detail: r }; }
    }
    // Home on Fire's own setup needs this on Fire OS builds that hide the Accessibility page.
    await this.shell(`pm grant ${HOME_ON_FIRE_PKG} android.permission.WRITE_SECURE_SETTINGS`);
    const ok = await this.setHomeService(HOME_ON_FIRE_PKG);
    this.log(ok ? 'Home on Fire now controls the Home button.' : "Couldn't switch on Home on Fire's Home button service; finish its setup on the TV.", ok ? 'ok' : 'warn');
    await this.shell(`am start -n ${HOME_ON_FIRE_PKG}/.MainActivity`);
    return { ok };
  }

  // Gives the Home button back to whichever app was chosen (Projectivy if
  // nothing was recorded).
  async restoreHomeChoice() {
    let choice = (await this.shell(`cat ${HOME_CHOICE_FILE} 2>/dev/null`)).trim();
    if (choice !== HOME_ON_FIRE_PKG) choice = PROJECTIVY_PKG;
    if (!(await this.getInstalled()).includes(choice)) return { skipped: true };
    if (choice === HOME_ON_FIRE_PKG) await this.shell(`pm grant ${HOME_ON_FIRE_PKG} android.permission.WRITE_SECURE_SETTINGS`);
    const ok = await this.setHomeService(choice);
    this.log(ok ? `${NAMES[choice]} controls the Home button.` : `Couldn't give ${NAMES[choice]} the Home button back. Try "Home screen".`, ok ? 'ok' : 'warn');
    return { ok, pkg: choice };
  }

  // --- installing / uninstalling -----------------------------------------

  // Installs an .apk, or a bundle (.apkm/.apks/.xapk: a zip of several .apk
  // parts) sending only the parts this stick's processor can run.
  async installFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let r;
    if (ext === '.apk') {
      r = await this.adb(['install', '-r', filePath]);
    } else {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'firestick-'));
      try {
        try { await unzip(filePath, path.join(tmp, 'x')); } catch { return { ok: false, reason: 'bad-bundle' }; }
        const abis = (await this.shell('getprop ro.product.cpu.abilist')).trim().replace(/-/g, '_').split(',');
        const parts = walk(path.join(tmp, 'x')).filter((f) => f.endsWith('.apk')).filter((f) => {
          const m = path.basename(f).match(/config\.(arm64_v8a|armeabi_v7a|armeabi|x86_64|x86)\.apk$/);
          return m ? abis.includes(m[1]) : true;
        });
        if (parts.length === 0) return { ok: false, reason: 'bad-bundle' };
        r = await this.adb(['install-multiple', '-r', ...parts]);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (/Success/.test(r)) return { ok: true };
    if (/INSTALL_FAILED_OLDER_SDK/.test(r)) {
      const sdk = (await this.shell('getprop ro.build.version.sdk')).trim();
      return { ok: false, reason: 'older-sdk', sdk };
    }
    return { ok: false, reason: 'failed', detail: r.trim() };
  }

  // Fully uninstalls an app you installed yourself (not Amazon's built-in
  // ones; those are handled by Clean up and Undo).
  async uninstallApp(pkg) {
    if (!PKG_RE.test(pkg) || !(await this.getYourApps()).includes(pkg)) return { ok: false };
    if (!/Success/.test(await this.shell(`pm uninstall ${pkg}`))) return { ok: false };
    this.log(`  uninstalled  ${nameOf(pkg)}`, 'ok');
    if (LEFTOVERS[pkg]) {
      await this.shell(`rm -rf ${LEFTOVERS[pkg]}`);
      this.log('  removed its leftover files', 'ok');
    }
    return { ok: true };
  }

  async androidVersion() { return (await this.shell('getprop ro.build.version.release')).trim(); }
  // The adb session dies with the reboot; the stick has to be opened again.
  async reboot() { await this.adb(['reboot']); await this.run(['disconnect', this.target]).catch(() => {}); }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

module.exports = {
  Stick, nameOf,
  ADS_TELEMETRY, EXTENDED_ADS_TELEMETRY, EXTENDED_OPTIONAL, AMAZON_APPS, PROTECTED, NAMES,
  PROJECTIVY_PKG, HOME_ON_FIRE_PKG, HOME_ON_FIRE_APK, PROJECTIVY_PAGE,
};
