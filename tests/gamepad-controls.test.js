'use strict';
// Tests for gamepad-controls.js (the Controllers card: pure helpers, then the card on a fake DOM).
// Run: node --test tests/gamepad-controls.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const G = require(path.join(__dirname, '..', 'assets', 'gamepad.js'));
const C = require(path.join(__dirname, '..', 'assets', 'gamepad-controls.js'));

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

const XBOX = { id: 'Xbox 360 Controller (STANDARD GAMEPAD)', mapping: 'standard' };
const KIT = { id: 'Harmonix Drum Kit', mapping: '' };

test('cardModel: standard pad, stored kit with cymbals, unknown controller needing setup', () => {
    const std = C.cardModel({ info: { ...XBOX, index: 0 }, nth: 1, binding: G.STANDARD_GAMEPAD, offsetMs: 0 });
    assert.deepEqual(std, { key: XBOX.id + '#1', name: 'Xbox 360 Controller', kindLabel: 'Xbox-style gamepad',
        needsSetup: false, hasCymbals: false, offsetMs: 0 });
    const kit = { kind: 'kit', map: { red_pad: { type: 'button', index: 1 }, yellow_cymbal: { type: 'button', index: 6 } } };
    const m = C.cardModel({ info: { ...KIT, index: 1 }, nth: 2, binding: kit, offsetMs: 35 });
    assert.equal(m.key, 'Harmonix Drum Kit#2');
    assert.equal(m.name, 'Harmonix Drum Kit 2');
    assert.equal(m.kindLabel, 'Drum kit');
    assert.equal(m.hasCymbals, true);
    assert.equal(m.offsetMs, 35);
    const none = C.cardModel({ info: { ...KIT, index: 1 }, nth: 1, binding: null, offsetMs: undefined });
    assert.equal(none.kindLabel, 'Needs setup');
    assert.equal(none.needsSetup, true);
    assert.equal(none.hasCymbals, false);
    assert.equal(none.offsetMs, 0);
    // Core's own key wins when list() reports it.
    assert.equal(C.cardModel({ info: { ...KIT, controllerKey: 'core#9' }, nth: 1, binding: null }).key, 'core#9');
});

test('clampOffset rounds to 5 and clamps to ±250', () => {
    assert.equal(C.clampOffset(7), 5);
    assert.equal(C.clampOffset(8), 10);
    assert.equal(C.clampOffset(2.4), 0);
    assert.equal(C.clampOffset(-2.5), 0);
    assert.ok(Object.is(C.clampOffset(-2.5), 0), 'never -0');
    assert.equal(C.clampOffset(300), 250);
    assert.equal(C.clampOffset(-300), -250);
    assert.equal(C.clampOffset(-251), -250);
    assert.equal(C.clampOffset('abc'), 0);
    assert.equal(C.clampOffset(Infinity), 0);
    assert.equal(C.OFFSET_MIN, -250);
    assert.equal(C.OFFSET_MAX, 250);
    assert.equal(C.OFFSET_STEP, 5);
});

// ── The card on a fake DOM ──

function fakeElement(tag) {
    const el = {
        tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {}, listeners: {}, parentNode: null,
        textContent: '', value: '', disabled: false, hidden: false, className: '', attrs: {},
        appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = el; el.children.push(c); return c; },
        append(...cs) { for (const c of cs) el.appendChild(c); },
        replaceChildren(...cs) { for (const c of el.children.slice()) c.remove(); for (const c of cs) el.appendChild(c); },
        remove() { const p = el.parentNode; if (p) { p.children.splice(p.children.indexOf(el), 1); el.parentNode = null; } },
        setAttribute(k, v) { el.attrs[k] = v; },
        addEventListener(type, fn) { (el.listeners[type] || (el.listeners[type] = [])).push(fn); },
        fire(type) { for (const fn of (el.listeners[type] || []).slice()) fn({ type, target: el }); },
    };
    return el;
}
function find(root, dr) {
    if (!root) return null;
    if (root.dataset && root.dataset.dr === dr) return root;
    for (const c of root.children || []) { const r = find(c, dr); if (r) return r; }
    return null;
}
function findAll(root, dr, out) {
    out = out || [];
    if (root.dataset && root.dataset.dr === dr) out.push(root);
    for (const c of root.children || []) findAll(c, dr, out);
    return out;
}

function fakeGi(pads) {
    const held = new Map();
    const gi = {
        version: 1, changeFns: [], pads,
        get claimCount() { return held.size; },
        list() {
            return pads.map((p, index) => ({ index, id: p.id, mapping: p.mapping, connected: p.connected !== false,
                claimedBy: held.has(index) ? held.get(index).owner : null }));
        },
        claim(index, owner) {
            if (!pads[index]) return null;
            const c = held.get(index);
            if (c) return c.owner === owner ? c.handle : null;
            const rec = { owner, listeners: [] };
            const n = pads.slice(0, index + 1).filter((p) => p.id === pads[index].id).length;
            rec.handle = {
                index, id: pads[index].id, controllerKey: pads[index].id + '#' + n,
                addListener(fn) { if (!rec.listeners.includes(fn)) rec.listeners = rec.listeners.concat(fn); },
                removeListener(fn) { rec.listeners = rec.listeners.filter((f) => f !== fn); },
                release() { if (held.get(index) !== rec) return; held.delete(index); gi.change('release', index); },
            };
            held.set(index, rec);
            gi.change('claim', index);
            return rec.handle;
        },
        owner(i) { const c = held.get(i); return c ? c.owner : null; },
        on(name, fn) { gi.changeFns.push(fn); return () => { gi.changeFns = gi.changeFns.filter((f) => f !== fn); }; },
        change(type, index) { for (const fn of gi.changeFns.slice()) fn({ type, index }); },
        emit(ev, padIndex) { const c = held.get(padIndex || 0); if (c) for (const fn of c.listeners.slice()) fn(ev); },
        button(index, pressed, padIndex, t) {
            gi.emit({ type: 'button', index, value: pressed ? 1 : 0, pressed, t: t === undefined ? performance.now() / 1000 : t }, padIndex);
        },
    };
    return gi;
}

function setup(t, pads, extra) {
    const prevDoc = global.document, prevWin = global.window, prevStore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    global.document = { createElement: fakeElement };
    global.window = { navigator: {} };
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
    t.after(() => {
        global.document = prevDoc; global.window = prevWin;
        if (prevStore) Object.defineProperty(globalThis, 'localStorage', prevStore); else delete globalThis.localStorage;
    });
    const gi = pads ? fakeGi(pads) : null;
    const list = fakeElement('div');
    const saved = [], offsets = [];
    const card = C.create(Object.assign({
        G, gamepadInput: gi, list, owner: 'drums.controls',
        onBindingSaved: (k) => saved.push(k), onOffsetSaved: (k, ms) => offsets.push([k, ms]),
    }, extra || {}));
    return { gi, list, card, saved, offsets };
}

test('card: one per free connected controller, claimed as drums.controls, released on destroy', (t) => {
    const env = setup(t, [XBOX, KIT]);
    assert.equal(findAll(env.list, 'padCard').length, 2);
    assert.equal(env.gi.owner(0), 'drums.controls');
    assert.equal(env.gi.owner(1), 'drums.controls');
    assert.equal(find(env.list, 'padKind').textContent, 'Xbox-style gamepad');
    assert.equal(find(env.list, 'padCymbals').textContent, 'Cymbals: off');
    assert.equal(findAll(env.list, 'padKind')[1].textContent, 'Needs setup');
    assert.equal(env.gi.changeFns.length, 1);
    env.card.destroy();
    assert.equal(env.gi.claimCount, 0);
    assert.equal(env.gi.changeFns.length, 0);
    assert.equal(env.list.children.length, 0);
});

test('card: skips a controller another owner holds and one a band lane is pinned to; claims it when freed', (t) => {
    setup(t, []);   // storage and DOM fakes
    const gi = fakeGi([XBOX, KIT]);
    gi.claim(0, 'drums');
    const list = fakeElement('div');
    let pinned = true;
    const card = C.create({ G, gamepadInput: gi, list, owner: 'drums.controls', isPinned: () => pinned });
    assert.equal(findAll(list, 'padCard').length, 0, 'held by drums, and pinned');
    assert.equal(gi.owner(0), 'drums');
    assert.equal(gi.owner(1), null, 'a pinned controller is never claimed');
    assert.match(find(list, 'padNote').textContent, /in use/);
    pinned = false;
    gi.change('release', 1);
    assert.equal(findAll(list, 'padCard').length, 1);
    assert.equal(gi.owner(1), 'drums.controls');
    card.destroy();
    assert.equal(gi.owner(0), 'drums', 'the other owner keeps its claim');
});

test('card: a controller connecting while open gets a card; one leaving loses it', (t) => {
    const pads = [XBOX, { ...KIT, connected: false }];
    const env = setup(t, pads);
    assert.equal(findAll(env.list, 'padCard').length, 1);
    pads[1] = KIT;
    env.gi.change('connect', 1);
    assert.equal(findAll(env.list, 'padCard').length, 2);
    assert.equal(env.gi.owner(1), 'drums.controls');
    pads[0] = { ...XBOX, connected: false };
    env.gi.change('disconnect', 0);
    assert.equal(findAll(env.list, 'padCard').length, 1);
    assert.equal(env.gi.owner(0), null, 'the gone controller released');
});

test('card: nothing connected says so; an older core says it needs a newer feedBack', (t) => {
    const env = setup(t, []);
    assert.match(find(env.list, 'padNote').textContent, /No controllers connected/);
    const old = setup(t, null);
    assert.match(find(old.list, 'padNote').textContent, /newer feedBack/);
    old.card.refresh();
    old.card.destroy();
    assert.equal(old.list.children.length, 0);
});

test('card: lights follow the binding, write only on a change, and a kit hit lights its cymbal', (t) => {
    const env = setup(t, [XBOX]);
    const red = find(env.list, 'light-red_pad');
    env.gi.button(4, true);
    assert.equal(red.dataset.on, '1');
    assert.equal(red.style.background, '#e53935');
    red.style.background = 'sentinel';
    env.gi.button(4, true);   // no mapper change: no write
    assert.equal(red.style.background, 'sentinel');
    env.gi.button(4, false);
    assert.equal(red.dataset.on, '0');
    assert.equal(find(env.list, 'light-yellow_cymbal').dataset.on, '0');
});

test('set up as drum kit walks the kit actions, Skip only on optional ones, saves and reports the binding', (t) => {
    const env = setup(t, [KIT]);
    assert.equal(find(env.list, 'padSetupNote').hidden, false, 'needs setup');
    find(env.list, 'setupKit').fire('click');
    const text = () => find(env.list, 'padPromptText').textContent;
    const skip = find(env.list, 'padSkip');
    assert.match(text(), /red pad/);
    assert.equal(skip.hidden, true, 'red pad is required');
    let n = 10;
    for (const a of ['red_pad', 'yellow_pad', 'blue_pad', 'green_pad', 'kick']) env.gi.button(n++, true, 0, n);
    assert.match(text(), /yellow cymbal/);
    assert.equal(skip.hidden, false, 'a cymbal can be skipped');
    env.gi.button(n++, true, 0, n);   // yellow cymbal
    skip.fire('click');               // blue cymbal
    skip.fire('click');               // green cymbal
    assert.match(text(), /Star power/);
    skip.fire('click');               // star power
    assert.match(text(), /Start/);
    assert.equal(skip.hidden, true, 'pause is required');
    assert.deepEqual(env.saved, []);
    env.gi.button(n++, true, 0, n);
    assert.deepEqual(env.saved, ['Harmonix Drum Kit#1']);
    const b = G.loadBindings()['Harmonix Drum Kit#1'];
    assert.equal(b.kind, 'kit');
    assert.deepEqual(b.map.kick, { type: 'button', index: 14 });
    assert.deepEqual(b.map.yellow_cymbal, { type: 'button', index: 15 });
    assert.equal(b.map.blue_cymbal, undefined);
    assert.equal(find(env.list, 'padKind').textContent, 'Drum kit');
    assert.equal(find(env.list, 'padCymbals').textContent, 'Cymbals: on');
    assert.equal(find(env.list, 'padSetupNote').hidden, true);
    assert.equal(find(env.list, 'padPrompt').hidden, true);
    // The new binding drives the lights.
    env.gi.button(15, true, 0, 99);
    assert.equal(find(env.list, 'light-yellow_cymbal').dataset.on, '1');
});

test('set up as drum kit: a colour and flag button in one poll bind one action (ruling 13), Cancel saves nothing', (t) => {
    const env = setup(t, [KIT]);
    find(env.list, 'setupKit').fire('click');
    env.gi.button(1, true, 0, 5);
    env.gi.button(8, true, 0, 5);   // same poll: the flag button
    assert.match(find(env.list, 'padPromptText').textContent, /yellow pad/);
    find(env.list, 'padCancel').fire('click');
    assert.equal(find(env.list, 'padPrompt').hidden, true);
    assert.deepEqual(G.loadBindings(), {});
    assert.deepEqual(env.saved, []);
});

test('use gamepad layout: a standard pad forgets its stored binding; another controller walks the gamepad actions', (t) => {
    const key = XBOX.id + '#1';
    const env = setup(t, [XBOX, KIT]);
    G.saveBinding(key, { kind: 'gamepad', map: { red_pad: { type: 'button', index: 9 } } });
    env.card.refresh();   // nothing changed: keeps the card
    const [xbox, kit] = findAll(env.list, 'useGamepad');
    xbox.fire('click');
    assert.equal(G.loadBindings()[key], undefined);
    assert.deepEqual(env.saved, [key]);
    assert.equal(findAll(env.list, 'padKind')[0].textContent, 'Xbox-style gamepad');
    // The kit controller records the gamepad layout.
    kit.fire('click');
    const actions = G.SETUP_ACTIONS.gamepad;
    let t0 = 1;
    for (let i = 0; i < actions.length; i++) env.gi.button(20 + i, true, 1, t0++);
    const b = G.loadBindings()['Harmonix Drum Kit#1'];
    assert.equal(b.kind, 'gamepad');
    assert.deepEqual(Object.keys(b.map), actions.slice());
    assert.deepEqual(env.saved, [key, 'Harmonix Drum Kit#1']);
});

test('rebind one action keeps the rest and ignores controls other actions use', (t) => {
    const env = setup(t, [XBOX]);
    const key = XBOX.id + '#1';
    find(env.list, 'padRebindAction').value = 'kick';
    find(env.list, 'padRebind').fire('click');
    assert.match(find(env.list, 'padPromptText').textContent, /kick/);
    env.gi.button(4, true, 0, 1);    // red's button: ignored
    env.gi.button(12, true, 0, 2);
    const b = G.loadBindings()[key];
    assert.equal(b.kind, 'gamepad');
    assert.deepEqual(b.map.kick, { type: 'button', index: 12 });
    assert.deepEqual(b.map.red_pad, { type: 'button', index: 4 });
    assert.deepEqual(env.saved, [key]);
    assert.equal(G.STANDARD_GAMEPAD.map.kick.index, 0, 'the built-in layout is untouched');
});

test('rebind is disabled until the controller has a binding', (t) => {
    const env = setup(t, [KIT]);
    assert.equal(find(env.list, 'padRebind').disabled, true);
});

test('input offset: step 5, clamped to ±250, handed to onOffsetSaved; junk restores the stored value', (t) => {
    const env = setup(t, [XBOX]);
    G.setOffset(XBOX.id + '#1', 40);
    const input = find(env.list, 'padOffset');
    assert.equal(input.min, '-250');
    assert.equal(input.max, '250');
    assert.equal(input.step, '5');
    assert.equal(input.value, '0');
    input.value = '23';
    input.fire('change');
    assert.equal(input.value, '25');
    input.value = '-999';
    input.fire('change');
    assert.equal(input.value, '-250');
    assert.deepEqual(env.offsets, [[XBOX.id + '#1', 25], [XBOX.id + '#1', -250]]);
    input.value = 'abc';
    input.fire('change');
    assert.equal(input.value, '40', 'restored from storage');
    assert.equal(env.offsets.length, 2);
});

test('a card shows the controller\'s stored offset', (t) => {
    setup(t, []);
    G.setOffset(XBOX.id + '#1', -15);
    const list = fakeElement('div');
    const card = C.create({ G, gamepadInput: fakeGi([XBOX]), list, owner: 'drums.controls' });
    assert.equal(find(list, 'padOffset').value, '-15');
    card.destroy();
});

test('card: a change event that leaves the cards as they are does not rebuild the list', (t) => {
    const env = setup(t, [XBOX, KIT]);
    let replaced = 0;
    const orig = env.list.replaceChildren;
    env.list.replaceChildren = (...a) => { replaced++; return orig(...a); };
    const first = env.list.children.slice();
    env.gi.change('claim', 5);
    env.gi.change('release', 5);
    assert.equal(replaced, 0, 'a focused input keeps its place');
    assert.deepEqual(env.list.children, first);
});

test('card: the claim\'s controllerKey is the card\'s key', (t) => {
    const env = setup(t, [XBOX]);
    env.card.destroy();
    const gi = fakeGi([XBOX]);
    const realClaim = gi.claim;
    gi.claim = (i, o) => { const h = realClaim(i, o); return h && Object.assign(h, { controllerKey: 'Renumbered#2' }); };
    const list = fakeElement('div');
    const offsets = [];
    const card = C.create({ G, gamepadInput: gi, list, owner: 'drums.controls', onOffsetSaved: (k, ms) => offsets.push([k, ms]) });
    const input = find(list, 'padOffset');
    input.value = '10';
    input.fire('change');
    assert.deepEqual(offsets, [['Renumbered#2', 10]]);
    card.destroy();
});
