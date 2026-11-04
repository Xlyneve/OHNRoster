const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
new Function(script.replace(/^\s*import[\s\S]*?from\s+"[^"]+";/gm, ''));

function setup() {
  let now = 0, status, logout, signedOut = false;
  const requests = [], timers = new Map();
  const progress = { open: false, showModal() { this.open = true; }, close() { this.open = false; }, addEventListener() {} };
  const title = {}, detail = {}, button = {}, logoutBtn = { addEventListener(_, fn) { logout = fn; } };
  const context = vm.createContext({
    performance: { now: () => now }, TextEncoder,
    setTimeout(fn) { const id = {}; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    setDoc(ref, data, options) { return new Promise((resolve, reject) => requests.push({ data, options, resolve, reject })); },
    doc: () => ({}), db: {}, canEdit: true,
    roster: { '2027-3-1': { shifts: [{ name: 'Test', time: '8-4' }], notes: '', isHoliday: false }, '2027-3-2': { shifts: [] } },
    nurses: [{ name: 'Test', color: '#fff' }],
    showRosterStatus: text => { status = text; },
    window: { addEventListener() {} }, console: { info() {}, error() {} },
    alert() {}, logoutBtn,
    document: { getElementById: id => ({ logoutProgress: progress, logoutProgressTitle: title, logoutProgressDetail: detail, returnToRoster: button })[id] },
    signOut: async () => { signedOut = true; }, auth: {}, updateUIOnAuth() {}, closeAuthModal() {}
  });
  const helper = source.slice(source.indexOf('  const pendingSaves ='), source.indexOf('  /** ---------- Firebase Data ---------- **/'));
  const save = source.slice(source.indexOf('  async function saveData('), source.indexOf('function renderNoticeBoard()'));
  const handler = source.slice(source.indexOf("  logoutBtn.addEventListener('click', async () => {"), source.indexOf("  onAuthStateChanged(auth,"));
  vm.runInContext(helper + save + handler + '\nglobalThis.api = { saveData, saveRosterDocument, pendingSaves };', context);
  return { context, api: context.api, requests, progress, title, button,
    status: () => status, logout: () => logout(), signedOut: () => signedOut,
    slow() { now = 10001; for (const fn of [...timers.values()]) fn(); }
  };
}

(async () => {
  const h = setup();
  const edit = h.api.saveData('2027-3-1');
  assert.deepEqual(Object.keys(h.requests[0].data.roster), ['2027-3-1']);
  assert.equal(h.requests[0].data.nurses, undefined);
  assert.equal(h.requests[0].options.mergeFields[0], 'roster.2027-3-1');
  h.context.roster['2027-3-1'].notes = 'later edit';
  assert.equal(h.requests[0].data.roster['2027-3-1'].notes, '');
  const logout = h.logout();
  assert(h.progress.open);
  assert(!h.signedOut());
  h.slow();
  assert.match(h.status(), /Taking longer/);
  assert.match(h.title.textContent, /Taking longer/);
  h.button.onclick();
  await logout;
  assert(!h.progress.open);
  assert(!h.signedOut());
  assert.equal(h.api.pendingSaves.size, 1);
  h.requests[0].resolve(); await edit;
  assert.equal(h.status(), 'Saved');
  await h.logout(); assert(h.signedOut());

  const failed = setup();
  const badEdit = failed.api.saveData('2027-3-1');
  failed.requests[0].reject(new Error('permission-denied')); await badEdit;
  const other = failed.api.saveData(); failed.requests[1].resolve(); await other;
  assert.match(failed.status(), /could not be saved/);
  await failed.logout(); assert(!failed.signedOut());
  const retry = failed.api.saveData('2027-3-1'); failed.requests[2].resolve(); await retry;
  assert.equal(failed.status(), 'Saved');

  const waiting = setup();
  const reminder = waiting.api.saveRosterDocument({ nurseReminders: [] });
  const signout = waiting.logout();
  assert(!waiting.signedOut());
  waiting.requests[0].resolve(); await reminder; await signout;
  assert(waiting.signedOut());
  console.log('Passed: scoped day payloads, immutable requests, delayed-save messaging, cancel logout, acknowledged logout, failure isolation, retry, and reminder tracking.');
})().catch(error => { console.error(error); process.exitCode = 1; });
