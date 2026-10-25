// The window: a guided setup (the main way through) plus a tools screen with
// every single function, like the Windows tool's menu. All real work happens
// in the main process through window.fire.
'use strict';

const api = window.fire;
const $ = (id) => document.getElementById(id);

const state = {
  lang: 'en',
  stick: null, // { ip, name, removedCount }
  step: 0,
  launcher: null, // 'projectivy' | 'other' | 'keep'
  androidVer: null,
  adbSeen: false, // the adb step auto-advances only on its first visit
  afterReboot: false, // the connect step shows "restarting" instead of searching
  toolsPanel: 'preview',
  toolsMsg: null, // a message to show once the next tools panel has rendered
  mode: 'wizard',
};

// --- text ---------------------------------------------------------------

function t(key, vars = {}) {
  const s = (window.STRINGS[state.lang] && window.STRINGS[state.lang][key]) || window.STRINGS.en[key] || key;
  return s.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function applyStaticText() {
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.lang));
  document.documentElement.lang = state.lang;
}

function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('lang', lang); } catch { /* fine */ }
  applyStaticText();
  render();
}

// --- tiny DOM builder -----------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'onclick') n.addEventListener('click', v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}
const p = (text, cls) => h('p', cls ? { class: cls } : {}, text);
const btn = (label, onclick, cls = '') => h('button', { class: cls, onclick }, label);
const list = (items) => h('ol', {}, ...items.map((i) => h('li', {}, i)));

// --- console, busy, modal -------------------------------------------------

function logLine({ message, level }) {
  for (const id of ['console', 'console2']) {
    const c = $(id);
    const line = h('div', { class: `l-${level || 'info'}` }, message);
    c.append(line);
    while (c.children.length > 400) c.removeChild(c.firstChild);
    c.scrollTop = c.scrollHeight;
  }
}

// Runs fn while every button and input is disabled, so nothing can start
// a second action in the middle of the first.
let busyCount = 0;
async function busy(text, fn) {
  busyCount++;
  $('busyText').textContent = text || t('busy');
  $('busy').classList.remove('hidden');
  document.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
  try { return await fn(); } finally {
    busyCount--;
    if (busyCount === 0) {
      $('busy').classList.add('hidden');
      document.querySelectorAll('button, input').forEach((b) => { b.disabled = false; });
    }
  }
}

// Anything that goes wrong in a click handler or an IPC call lands here:
// it is written to the console panel and shown in a box, never swallowed.
function showError(e) {
  const msg = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
  logLine({ message: msg, level: 'error' });
  if ($('modal').classList.contains('hidden')) confirm(t('errGeneric', { msg }), t('ok'), t('cancel'));
}
window.addEventListener('unhandledrejection', (ev) => showError(ev.reason));
window.addEventListener('error', (ev) => showError(ev.error || ev.message));

function confirm(text, yes = t('yes'), no = t('no')) {
  return new Promise((resolve) => {
    $('modalText').textContent = text;
    $('modalYes').textContent = yes;
    $('modalNo').textContent = no;
    $('modal').classList.remove('hidden');
    const close = (v) => { $('modal').classList.add('hidden'); $('modalYes').onclick = null; $('modalNo').onclick = null; resolve(v); };
    $('modalYes').onclick = () => close(true);
    $('modalNo').onclick = () => close(false);
  });
}

// Restarts the stick. The adb session dies with it, so the app goes back to
// the connect step and waits for the person to connect again.
async function rebootStick() {
  await busy(t('busy'), () => api.reboot());
  state.stick = null;
  state.afterReboot = true;
  updateBadge();
  setMode('wizard');
  goto(3);
}

async function restartPrompt() {
  if (await confirm(t('restartQ'), t('restartYes'), t('restartNo'))) await rebootStick();
}

function updateBadge() {
  const b = $('stickBadge');
  if (state.stick) { b.textContent = `${state.stick.name} · ${state.stick.ip}`; b.classList.remove('hidden'); } else b.classList.add('hidden');
  $('btnModeTools').classList.toggle('hidden', !state.stick || state.mode === 'tools');
  $('btnModeWizard').classList.toggle('hidden', state.mode === 'wizard');
}

// --- install helper (shared) ---------------------------------------------

async function pickAndInstall() {
  const r = await busy(t('busy'), () => api.pickAndInstall());
  if (r.ok) return { ok: true, text: t('installOk', { file: r.file }) };
  if (r.reason === 'cancelled') return { ok: false, text: t('installCancelled') };
  if (r.reason === 'older-sdk') return { ok: false, text: t('installOlderSdk', { sdk: r.sdk }) };
  if (r.reason === 'bad-bundle') return { ok: false, text: t('installBadBundle') };
  return { ok: false, text: t('installFailed', { detail: r.detail || r.reason }) };
}

// Checklist of apps a cleanup would ask about. Returns the element and a
// function that reads the ticked packages.
function cleanupChecklist(preview) {
  const boxes = [];
  const row = (a) => {
    const cb = h('input', { type: 'checkbox' });
    boxes.push([cb, a.pkg]);
    return h('label', { class: 'check' }, cb, h('span', {}, a.name || a.pkg), a.name ? h('span', { class: 'pkg' }, a.pkg) : null);
  };
  const amazon = preview.asked.filter((a) => a.amazon);
  const yours = preview.asked.filter((a) => !a.amazon);
  const el = h('div', {},
    h('h3', {}, t('cleanupAuto')),
    p(t('cleanupAutoWhy'), 'dim'),
    preview.auto.length ? h('div', {}, ...preview.auto.map((pk) => h('div', { class: 'plain' }, pk))) : p(t('cleanupAutoNone'), 'dim'),
    h('h3', {}, t('cleanupAmazon')),
    amazon.length ? h('div', {}, ...amazon.map(row)) : p(t('cleanupNoneAsked'), 'dim'),
    amazon.some((a) => a.pkg === 'com.amazon.bueller.photos') ? p(t('cleanupPhotosWarn'), 'warn') : null,
    h('h3', {}, t('cleanupYours')),
    yours.length ? h('div', {}, ...yours.map(row)) : p(t('cleanupNoneAsked'), 'dim'),
    p(t('cleanupNote'), 'dim'),
  );
  return { el, chosen: () => boxes.filter(([cb]) => cb.checked).map(([, pk]) => pk) };
}

async function runCleanup(chosen, container) {
  const r = await busy(t('busy'), () => api.cleanup({ chosen }));
  container.replaceChildren(
    h('h2', {}, t('cleanupDoneTitle')),
    p(r.removed.length + r.failed.length === 0 ? t('cleanupNothing') : t('cleanupResult', { removed: r.removed.length, failed: r.failed.length }), 'ok'),
  );
  return r;
}

// =========================================================================
// Guided setup
// =========================================================================

const STEPS = ['stepWelcome', 'stepAdb', 'stepPrepare', 'stepConnect', 'stepTvSettings', 'stepCleanup', 'stepLauncher', 'stepHomeSetup', 'stepFinish'];

function goto(step) { state.step = step; render(); }
function nextStep() { goto(Math.min(state.step + 1, STEPS.length - 1)); }

function renderWizardNav() {
  const nav = $('wizardNav');
  nav.replaceChildren(...STEPS.map((key, i) => {
    const cls = `nav${i === state.step ? ' active' : ''}`;
    const b = h('button', { class: cls, onclick: () => { if (i <= state.step || state.stick) goto(i); } },
      h('span', { class: `key${i < state.step ? ' done' : ''}` }, i < state.step ? '✓' : String(i + 1)),
      h('span', {}, t(key)));
    return b;
  }));
}

const wizard = {
  // 0 welcome
  stepWelcome() {
    const langBtn = (lang, label) => h('button', { class: `small${state.lang === lang ? ' active' : ''}`, 'data-lang': lang, onclick: () => setLang(lang) }, label);
    return h('div', {},
      h('div', { class: 'seg big' }, langBtn('de', 'Deutsch'), langBtn('en', 'English')),
      h('h1', {}, t('welcomeTitle')),
      p(t('welcomeBody')),
      h('h3', {}, t('welcomeNeed')),
      h('ul', {}, h('li', {}, t('welcomeNeed1')), h('li', {}, t('welcomeNeed2')), h('li', {}, t('welcomeNeed3'))),
      p(t('welcomeSafe'), 'ok'),
      p(t('welcomeNotSupported'), 'dim'),
      h('div', { class: 'actions' }, btn(t('welcomeStart'), nextStep, 'primary')),
    );
  },

  // 1 adb
  stepAdb() {
    const status = h('p', { class: 'status' });
    const progress = h('div', { class: 'progress hidden' }, h('div', { class: 'bar' }));
    const err = h('p', { class: 'error hidden' });
    const dl = btn(t('adbDownload'), async () => {
      err.classList.add('hidden');
      progress.classList.remove('hidden');
      const off = api.onAdbProgress(({ got, total }) => {
        const pct = total ? Math.round((got / total) * 100) : 0;
        progress.firstChild.style.width = `${pct}%`;
        status.textContent = t('adbDownloading', { pct });
      });
      const r = await busy(t('adbDownloading', { pct: 0 }), () => api.adbDownload());
      off();
      progress.classList.add('hidden');
      if (r.ok) { status.textContent = t('adbFound', { path: r.path }); status.className = 'status ok'; dl.classList.add('hidden'); setTimeout(() => { if (state.step === 1) nextStep(); }, 600); } else { err.textContent = t('adbFailed', { error: r.error }); err.classList.remove('hidden'); }
    }, 'primary');
    const recheck = btn(t('adbRecheck'), () => check(), 'ghost');
    const check = async () => {
      const s = await api.adbStatus();
      if (s.found) { status.textContent = t('adbFound', { path: s.path }); status.className = 'status ok'; dl.classList.add('hidden'); }
      else { status.textContent = ''; dl.classList.remove('hidden'); }
      return s;
    };
    const el = h('div', {},
      h('h1', {}, t('adbTitle')),
      p(t('adbBody')),
      p(h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openUrl({ url: 'https://developer.android.com/studio/terms' }); } }, t('adbTerms')), 'dim'),
      status, progress, err,
      h('div', { class: 'actions' }, dl, recheck, btn(t('next'), nextStep, 'ghost')),
    );
    // Found on the first visit: move on by itself. Coming back here on
    // purpose (Back) stays here.
    const firstVisit = !state.adbSeen;
    state.adbSeen = true;
    check().then((s) => { if (s.found && firstVisit && !state.stick) setTimeout(() => { if (state.step === 1) nextStep(); }, 800); });
    return el;
  },

  // 2 prepare the stick
  stepPrepare() {
    return h('div', {},
      h('h1', {}, t('prepareTitle')),
      p(t('prepareBody')),
      h('div', { class: 'tv' }, list([t('prepare1'), t('prepare2'), t('prepare3'), t('prepare4'), t('prepare5')])),
      h('div', { class: 'actions' }, btn(t('prepareDone'), nextStep, 'primary'), btn(t('back'), () => goto(1), 'ghost')),
    );
  },

  // 3 connect
  stepConnect() {
    const status = h('p', { class: 'status' }, t('searching'));
    const progress = h('div', { class: 'progress' }, h('div', { class: 'bar' }));
    const found = h('ul', { class: 'list hidden' });
    const tv = h('div', { class: 'tv hidden' }, h('strong', {}, t('tvLook')), list([t('tvStep1'), t('tvStep2')]));
    const err = h('p', { class: 'error hidden' });
    const input = h('input', { type: 'text', placeholder: '192.168.1.23', spellcheck: 'false' });
    const el = h('div', {},
      h('h1', {}, t('connectTitle')),
      status, progress, found, tv,
      h('details', {}, h('summary', {}, t('prepareTitle')), list([t('prepare1'), t('prepare2'), t('prepare3'), t('prepare4')])),
      h('div', { class: 'row' }, input, btn(t('connectBtn'), () => connect(input.value.trim()), 'primary'), btn(t('searchAgain'), () => search(), 'ghost')),
      err, p(t('ipHint'), 'dim'),
    );
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(input.value.trim()); });

    let connecting = false; // one connect at a time (Enter can be pressed twice)
    const connect = async (ip) => {
      if (connecting) return;
      err.classList.add('hidden');
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { err.textContent = t('errBadIp'); err.classList.remove('hidden'); return; }
      connecting = true;
      status.textContent = t('connecting', { ip }); status.className = 'status';
      const offPrompt = api.onPrompt(() => tv.classList.remove('hidden'));
      let r;
      try { r = await busy(t('connecting', { ip }), () => api.open({ ip })); } finally { connecting = false; offPrompt(); tv.classList.add('hidden'); }
      if (!r.ok) {
        const msg = r.reason === 'not-authorized' ? t('errNotAuthorized') : r.reason === 'no-adb' ? t('errNoAdb') : r.reason === 'bad-ip' ? t('errBadIp') : t('errUnreachable', { ip });
        err.textContent = msg; err.classList.remove('hidden'); status.textContent = '';
        return;
      }
      state.stick = { ip, name: r.name, removedCount: r.removedCount };
      state.launcher = null;
      state.afterReboot = false;
      updateBadge();
      status.textContent = t('connected', { name: r.name }); status.className = 'status ok';
      logLine({ message: t('removedSoFar', { n: r.removedCount }), level: 'dim' });
      setTimeout(() => { if (state.step === 3) nextStep(); }, 700);
    };

    const search = async () => {
      found.classList.add('hidden'); found.replaceChildren(); err.classList.add('hidden');
      status.textContent = t('searching'); status.className = 'status';
      progress.classList.remove('hidden'); progress.firstChild.style.width = '0%';
      const off = api.onFindProgress(({ done, total }) => { progress.firstChild.style.width = `${total ? Math.round((done / total) * 100) : 0}%`; });
      let r;
      try { r = await busy(t('searching'), () => api.find({})); } finally { off(); progress.classList.add('hidden'); }
      if (r.found.length === 1) { status.textContent = t('foundOne', { ip: r.found[0] }); input.value = r.found[0]; connect(r.found[0]); return; }
      if (r.found.length > 1) {
        status.textContent = t('foundMany');
        found.classList.remove('hidden');
        found.replaceChildren(...r.found.map((ip) => h('li', {}, h('span', {}, ip), btn(t('use'), () => { input.value = ip; connect(ip); }, 'small primary'))));
        return;
      }
      status.textContent = t('foundNone'); status.className = 'status warn';
    };
    progress.classList.add('hidden');
    if (state.stick) { status.textContent = t('connected', { name: state.stick.name }); status.className = 'status ok'; }
    else if (state.afterReboot) { status.textContent = t('finishRestarted'); status.className = 'status ok'; }
    else setTimeout(search, 50);
    return el;
  },

  // 4 tv settings
  stepTvSettings() {
    return h('div', {},
      h('h1', {}, t('tvSettingsTitle')),
      p(t('tvSettingsBody')),
      h('div', { class: 'tv' }, list([t('tvSettings1'), t('tvSettings2'), t('tvSettings3')])),
      h('div', { class: 'actions' }, btn(t('tvSettingsDone'), nextStep, 'primary'), btn(t('skip'), nextStep, 'ghost')),
    );
  },

  // 5 cleanup
  stepCleanup() {
    const body = h('div', {}, p(t('busy'), 'dim'));
    const el = h('div', {}, h('h1', {}, t('cleanupTitle')), body);
    (async () => {
      let preview;
      try { preview = await busy(t('busy'), () => api.preview()); } catch (e) { body.replaceChildren(p(String(e.message || e), 'error')); throw e; }
      const { el: check, chosen } = cleanupChecklist(preview);
      const result = h('div', {});
      const actions = h('div', { class: 'actions' },
        btn(t('cleanupRun'), async () => {
          await runCleanup(chosen(), result);
          check.classList.add('hidden'); actions.classList.add('hidden');
          result.append(h('div', { class: 'actions' }, btn(t('next'), nextStep, 'primary')));
        }, 'primary'),
        btn(t('skip'), nextStep, 'ghost'),
      );
      body.replaceChildren(check, result, actions);
    })();
    return el;
  },

  // 6 launcher choice
  stepLauncher() {
    const note = h('p', { class: 'warn hidden' });
    let choice = state.launcher || 'projectivy';
    const radios = [];
    const option = (value, title, body) => {
      const r = h('input', { type: 'radio', name: 'launcher', value });
      if (value === choice) r.checked = true;
      r.addEventListener('change', () => { choice = value; });
      radios.push(r);
      return h('label', { class: 'check top' }, r, h('div', {}, h('strong', {}, title), p(body, 'dim')));
    };
    const el = h('div', {},
      h('h1', {}, t('launcherTitle')),
      p(t('launcherBody')),
      note,
      option('projectivy', t('launcherProjectivy'), t('launcherProjectivyBody')),
      option('other', t('launcherOther'), t('launcherOtherBody')),
      option('keep', t('launcherKeep'), t('launcherKeepBody')),
      h('div', { class: 'actions' }, btn(t('launcherChoose'), () => { state.launcher = choice; goto(choice === 'keep' ? 8 : 7); }, 'primary'), btn(t('back'), () => goto(5), 'ghost')),
    );
    api.androidVersion().then((v) => {
      state.androidVer = v;
      const major = parseInt(v, 10);
      if (major && major <= 5) { note.textContent = t('launcherFireOs5', { ver: v }); note.classList.remove('hidden'); }
      else if (major && major <= 7) { note.textContent = t('launcherFireOs6', { ver: v }); note.classList.remove('hidden'); }
    });
    return el;
  },

  // 7 home screen setup
  stepHomeSetup() {
    if (state.launcher === 'other') return wizard.otherSetup();
    return wizard.projectivySetup();
  },

  projectivySetup() {
    const ver = state.androidVer || '…';
    const msgB = h('p', { class: 'status' });
    const msgC = h('p', { class: 'status' });
    const msgD = h('p', { class: 'status' });
    const stepA = h('div', { class: 'step current' }, h('div', { class: 'n' }, 'A'), h('div', { class: 'body' },
      h('h2', {}, t('projA')), list([t('projA1'), t('projA2', { ver }), t('projA3')]),
      h('div', { class: 'actions' }, btn(t('projOpenPage'), () => api.openProjectivyPage(), 'primary'))));
    const stepB = h('div', { class: 'step' }, h('div', { class: 'n' }, 'B'), h('div', { class: 'body' },
      h('h2', {}, t('projB')), p(t('projB1')), msgB,
      h('div', { class: 'actions' }, btn(t('projInstall'), async () => {
        const r = await pickAndInstall();
        msgB.textContent = r.text; msgB.className = `status ${r.ok ? 'ok' : 'error'}`;
        if (r.ok) markInstalled();
      }, 'primary'))));
    const stepC = h('div', { class: 'step' }, h('div', { class: 'n' }, 'C'), h('div', { class: 'body' },
      h('h2', {}, t('projC')), list([t('projC1'), t('projC2')]), msgC,
      h('div', { class: 'actions' }, btn(t('projOpen'), async () => {
        await busy(t('busy'), () => api.openProjectivy());
        msgC.textContent = t('projOpened'); msgC.className = 'status ok';
        stepC.classList.replace('current', 'done'); stepD.classList.add('current');
      }, 'primary'))));
    const stepD = h('div', { class: 'step' }, h('div', { class: 'n' }, 'D'), h('div', { class: 'body' },
      h('h2', {}, t('projD')), p(t('projD1')), msgD,
      h('div', { class: 'actions' }, btn(t('projEnable'), async () => {
        const r = await busy(t('busy'), () => api.enableProjectivy());
        if (r.ok) { msgD.textContent = t('projEnabled'); msgD.className = 'status ok'; stepD.classList.replace('current', 'done'); }
        else { msgD.textContent = r.reason === 'not-installed' ? t('projNotInstalled') : t('projRejected'); msgD.className = 'status warn'; }
      }, 'primary'))));
    const markInstalled = () => {
      stepA.classList.replace('current', 'done'); stepB.classList.remove('current'); stepB.classList.add('done'); stepC.classList.add('current');
    };
    const el = h('div', {},
      h('h1', {}, t('projTitle')), p(t('projIntro'), 'dim'),
      h('div', { class: 'steps' }, stepA, stepB, stepC, stepD),
      h('div', { class: 'actions' }, btn(t('next'), nextStep, 'primary'), btn(t('back'), () => goto(6), 'ghost')),
    );
    api.hasProjectivy().then((has) => {
      if (has) { msgB.textContent = t('projAlready'); msgB.className = 'status ok'; markInstalled(); }
      else { stepA.classList.add('current'); stepB.classList.add('current'); }
    });
    return el;
  },

  otherSetup() {
    const msgA = h('p', { class: 'status' });
    const msgB = h('p', { class: 'status' });
    const el = h('div', {},
      h('h1', {}, t('otherTitle')),
      h('div', { class: 'steps' },
        h('div', { class: 'step current' }, h('div', { class: 'n' }, 'A'), h('div', { class: 'body' },
          h('h2', {}, t('otherA')), p(t('otherA1')), msgA,
          h('div', { class: 'actions' }, btn(t('otherInstall'), async () => { const r = await pickAndInstall(); msgA.textContent = r.text; msgA.className = `status ${r.ok ? 'ok' : 'error'}`; }, 'primary')))),
        h('div', { class: 'step current' }, h('div', { class: 'n' }, 'B'), h('div', { class: 'body' },
          h('h2', {}, t('otherB')), list([t('otherB1'), t('otherB2'), t('otherB3')]), msgB,
          h('div', { class: 'actions' }, btn(t('otherEnable'), async () => {
            const r = await busy(t('busy'), () => api.enableHomeOnFire());
            msgB.textContent = r.ok ? t('otherEnabled') : r.detail ? t('installFailed', { detail: r.detail }) : t('otherFailed');
            msgB.className = `status ${r.ok ? 'ok' : 'warn'}`;
          }, 'primary'))))),
      h('div', { class: 'actions' }, btn(t('next'), nextStep, 'primary'), btn(t('back'), () => goto(6), 'ghost')),
    );
    return el;
  },

  // 8 finish
  stepFinish() {
    return h('div', {},
      h('h1', {}, t('finishTitle')),
      p(t('finishBody')),
      h('div', { class: 'actions' }, btn(t('finishRestart'), rebootStick, 'primary'), btn(t('finishTools'), () => setMode('tools'), 'ghost')),
      h('h3', {}, t('finishTips')),
      h('ul', {}, ...(state.launcher === 'projectivy' ? [h('li', {}, t('finishTip1'))] : []), h('li', {}, t('finishTip2')), h('li', {}, t('finishTip3')), h('li', {}, t('finishTip4'))),
    );
  },
};

// =========================================================================
// Tools screen
// =========================================================================

const tools = {
  async preview() {
    const r = await busy(t('busy'), () => api.preview());
    return h('div', {},
      h('h1', {}, t('previewTitle')), p(t('previewBody')),
      h('h3', {}, t('cleanupAuto')),
      r.auto.length ? h('div', {}, ...r.auto.map((pk) => h('div', { class: 'plain' }, pk))) : p(t('cleanupAutoNone'), 'dim'),
      h('h3', {}, t('previewAsked')),
      r.asked.length ? h('div', {}, ...r.asked.map((a) => h('div', { class: 'plain' }, a.name ? `${a.name}  (${a.pkg})` : a.pkg))) : p(t('cleanupNoneAsked'), 'dim'),
      p(t('previewNone'), 'dim'),
    );
  },

  async cleanup() {
    const preview = await busy(t('busy'), () => api.preview());
    const { el: check, chosen } = cleanupChecklist(preview);
    const result = h('div', {});
    const actions = h('div', { class: 'actions' }, btn(t('cleanupRun'), async () => {
      await runCleanup(chosen(), result);
      check.classList.add('hidden'); actions.classList.add('hidden');
      await restartPrompt();
    }, 'primary'));
    return h('div', {}, h('h1', {}, t('cleanupTitle')), check, result, actions);
  },

  async undo() {
    const n = (await api.removedList()).length;
    const out = h('div', {});
    return h('div', {},
      h('h1', {}, t('undoTitle')),
      n ? p(t('undoBody', { n })) : p(t('undoNothing'), 'dim'),
      out,
      n ? h('div', { class: 'actions' }, btn(t('undoRun'), async () => {
        if (!(await confirm(t('undoConfirm', { n })))) return;
        const r = await busy(t('busy'), () => api.undo());
        out.replaceChildren(p(t('undoDone', { n: r.restored.length }), 'ok'));
        await restartPrompt();
      }, 'danger')) : null,
    );
  },

  async launcher() {
    const msg = h('p', { class: 'status' });
    return h('div', {},
      h('h1', {}, t('launcherToolTitle')), p(t('launcherToolBody')),
      h('div', { class: 'actions' },
        btn(t('launcherToolProjectivy'), async () => {
          const r = await busy(t('busy'), () => api.enableProjectivy());
          msg.textContent = r.ok ? t('projEnabled') : r.reason === 'not-installed' ? t('projNotInstalled') : t('projRejected');
          msg.className = `status ${r.ok ? 'ok' : 'warn'}`;
        }, 'primary'),
        btn(t('launcherToolOther'), async () => {
          const r = await busy(t('busy'), () => api.enableHomeOnFire());
          msg.textContent = r.ok ? t('otherEnabled') : r.detail ? t('installFailed', { detail: r.detail }) : t('otherFailed');
          msg.className = `status ${r.ok ? 'ok' : 'warn'}`;
        })),
      msg,
      p(t('otherB3'), 'dim'),
    );
  },

  async install() {
    const msg = h('p', { class: 'status' });
    return h('div', {},
      h('h1', {}, t('installTitle')), p(t('installBody')),
      h('div', { class: 'actions' }, btn(t('installPick'), async () => { const r = await pickAndInstall(); msg.textContent = r.text; msg.className = `status ${r.ok ? 'ok' : 'error'}`; }, 'primary')),
      msg,
    );
  },

  async uninstall() {
    const apps = await busy(t('busy'), () => api.yourApps());
    const msg = h('p', { class: 'status' });
    // A message left by the previous render of this panel (after an uninstall).
    if (state.toolsMsg && state.toolsMsg.panel === 'uninstall') { msg.textContent = state.toolsMsg.text; msg.className = `status ${state.toolsMsg.cls}`; }
    state.toolsMsg = null;
    return h('div', {},
      h('h1', {}, t('uninstallTitle')), p(t('uninstallBody')),
      apps.length ? h('ul', { class: 'list' }, ...apps.map((pk) => h('li', {}, h('span', { class: 'pkg' }, pk), btn(t('uninstallBtn'), async () => {
        if (!(await confirm(t('uninstallConfirm', { name: pk })))) return;
        const r = await busy(t('busy'), () => api.uninstall({ pkg: pk }));
        const text = r.ok ? t('uninstallDone', { name: pk }) : t('uninstallFailed', { name: pk });
        if (r.ok) { state.toolsMsg = { panel: 'uninstall', text, cls: 'ok' }; showTool('uninstall'); }
        else { msg.textContent = text; msg.className = 'status error'; }
      }, 'small danger')))) : p(t('uninstallNone'), 'dim'),
      msg,
      h('div', { class: 'actions' }, btn(t('refresh'), () => showTool('uninstall'), 'ghost')),
    );
  },

  async projectivy() {
    const ver = await api.androidVersion();
    const msg = h('p', { class: 'status' });
    return h('div', {},
      h('h1', {}, t('projTitle')), p(t('projIntro'), 'dim'),
      h('h3', {}, t('projA')), list([t('projA1'), t('projA2', { ver }), t('projA3')]),
      h('div', { class: 'actions' }, btn(t('projOpenPage'), () => api.openProjectivyPage(), 'primary')),
      h('h3', {}, t('projB')), p(t('projB1')),
      h('div', { class: 'actions' }, btn(t('projInstall'), async () => { const r = await pickAndInstall(); msg.textContent = r.text; msg.className = `status ${r.ok ? 'ok' : 'error'}`; })),
      h('h3', {}, t('projC')), p(t('projC1')),
      h('div', { class: 'actions' }, btn(t('projOpen'), async () => { await busy(t('busy'), () => api.openProjectivy()); msg.textContent = t('projOpened'); msg.className = 'status ok'; })),
      msg,
      p(t('projD1'), 'dim'),
    );
  },

  async reapply() {
    const out = h('div', {});
    return h('div', {},
      h('h1', {}, t('reapplyTitle')), p(t('reapplyBody')),
      out,
      h('div', { class: 'actions' }, btn(t('reapplyRun'), async () => {
        const r = await busy(t('busy'), () => api.reapply());
        if (r.nothing) { out.replaceChildren(p(t('reapplyNothing'), 'warn')); return; }
        out.replaceChildren(p(r.back.length ? t('reapplyBack', { n: r.back.length, total: r.total }) : t('reapplyAllOff', { total: r.total }), 'ok'));
        if (r.back.length) await restartPrompt();
      }, 'primary')),
    );
  },
};

// Only the most recently requested panel may fill the screen: a slower
// earlier one that finishes later is dropped.
let toolSeq = 0;
async function showTool(name) {
  const seq = ++toolSeq;
  state.toolsPanel = name;
  document.querySelectorAll('#screen-tools .nav[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  const panel = $('toolsPanel');
  panel.replaceChildren(p(t('busy'), 'dim'));
  let el;
  try {
    el = await tools[name]();
  } catch (e) {
    el = p(String(e.message || e), 'error');
  }
  if (seq === toolSeq) panel.replaceChildren(el);
}

// =========================================================================
// mode switching and startup
// =========================================================================

function setMode(mode) {
  // The tools need a connected stick; without one, go and connect first.
  if (mode === 'tools' && !state.stick) { state.mode = 'wizard'; mode = 'wizard'; state.step = 3; }
  state.mode = mode;
  $('screen-wizard').classList.toggle('hidden', mode !== 'wizard');
  $('screen-tools').classList.toggle('hidden', mode !== 'tools');
  updateBadge();
  if (mode === 'tools') showTool(state.toolsPanel); else render();
}

function render() {
  if (state.mode === 'tools') { showTool(state.toolsPanel); return; }
  renderWizardNav();
  const panel = $('wizardPanel');
  panel.replaceChildren(wizard[STEPS[state.step]]());
  panel.scrollTop = 0;
}

async function init() {
  const info = await api.appInfo();
  let lang = null;
  try { lang = localStorage.getItem('lang'); } catch { /* fine */ }
  if (!lang) lang = (info.locale || navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  state.lang = lang;
  applyStaticText();

  $('langDe').addEventListener('click', () => setLang('de'));
  $('langEn').addEventListener('click', () => setLang('en'));
  $('btnModeTools').addEventListener('click', () => setMode('tools'));
  $('btnModeWizard').addEventListener('click', () => setMode('wizard'));
  document.querySelectorAll('#screen-tools .nav[data-panel]').forEach((b) => b.addEventListener('click', () => showTool(b.dataset.panel)));
  $('btnSwitch').addEventListener('click', async () => {
    if (!(await confirm(t('switchConfirm', { name: state.stick ? state.stick.name : '' })))) return;
    state.stick = null; state.afterReboot = false; updateBadge(); setMode('wizard'); goto(3);
  });
  $('btnLogs').addEventListener('click', () => { logLine({ message: t('logsHint', { dir: info.logDir }), level: 'dim' }); api.openLogs(); });
  api.onLog(logLine);

  logLine({ message: `Fire Stick Debloat ${info.version}`, level: 'dim' });
  updateBadge();
  render();
}

init();
