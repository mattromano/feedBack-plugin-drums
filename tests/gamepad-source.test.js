'use strict';
// Tests for gamepad-source.js (claim lifecycle, hits, back-hold).
// Run: node --test tests/gamepad-source.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const G = require(path.join(__dirname, '..', 'assets', 'gamepad.js'));
const S = require(path.join(__dirname, '..', 'assets', 'gamepad-source.js'));

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
function withStorage(fn) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
    try { return fn(); } finally {
        if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
    }
}

// A fake core gamepad-input domain (see five-fret's tests/screen.test.js).
function fakeGamepadInput(pads, foreign) {
    const held = new Map();
    if (foreign) for (const i of foreign) held.set(i, { owner: 'other', listeners: [] });
    const gi = {
        claims: 0, releases: 0, changeFns: [], pads,
        get claimCount() { return held.size; },
        list() {
            return pads.map((p, index) => ({ index, id: p.id, mapping: p.mapping, connected: p.connected !== false,
                claimedBy: held.has(index) ? held.get(index).owner : null }));
        },
        claim(index, owner) {
            if (!pads[index]) return null;
            const c = held.get(index);
            if (c) return c.owner === owner ? c.handle : null;
            gi.claims++;
            const rec = { owner, listeners: [] };
            const n = pads.slice(0, index + 1).filter((p) => p.id === pads[index].id).length;
            rec.handle = {
                index, id: pads[index].id, controllerKey: pads[index].id + '#' + n,
                addListener(fn) { if (!rec.listeners.includes(fn)) rec.listeners = rec.listeners.concat(fn); },
                removeListener(fn) { rec.listeners = rec.listeners.filter((f) => f !== fn); },
                release() { if (held.get(index) !== rec) return; held.delete(index); gi.releases++; gi.change('release', index); },
            };
            held.set(index, rec);
            gi.change('claim', index);
            return rec.handle;
        },
        on(name, fn) { gi.changeFns.push(fn); return () => { gi.changeFns = gi.changeFns.filter((f) => f !== fn); }; },
        change(type, index) { for (const fn of gi.changeFns.slice()) fn({ type, index }); },
        listenerCount(i) { const c = held.get(i); return c ? c.listeners.length : 0; },
        button(index, value, padIndex = 0, t = 1.5) {
            const c = held.get(padIndex);
            const ev = { type: 'button', index, value, pressed: value >= 0.5, t };
            if (c) for (const fn of c.listeners.slice()) fn(ev);
        },
    };
    return gi;
}

function harness(pads, opts = {}) {
    const calls = { hits: [], activate: [], pause: 0, change: 0, back: 0 };
    const timers = [];
    const gi = opts.noGi ? null : fakeGamepadInput(pads, opts.foreign);
    const src = S.createSource({
        gamepadInput: gi, G,
        onHit: (pad, cymbal, t) => calls.hits.push([pad, cymbal, t]),
        onActivate: (t) => calls.activate.push(t),
        onPause: () => { calls.pause++; },
        onChange: () => { calls.change++; },
        onBackHold: () => { calls.back++; },
        setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
        clearTimer: (t) => { t.live = false; },
    });
    return { gi, src, calls, timers };
}

const XBOX = { id: 'Xbox', mapping: 'standard' };
const KIT = { id: 'Rock Band Drums', mapping: '' };
const kitBinding = { kind: 'kit', map: {
    red_pad: { type: 'button', index: 1 }, yellow_pad: { type: 'button', index: 2 }, blue_pad: { type: 'button', index: 3 },
    green_pad: { type: 'button', index: 4 }, kick: { type: 'button', index: 5 }, yellow_cymbal: { type: 'button', index: 6 },
} };

test('free mode claims a stored kit before a standard pad in an earlier slot', () => withStorage(() => {
    G.saveBinding('Rock Band Drums#1', kitBinding);
    const { gi, src } = harness([XBOX, KIT]);
    src.setWanted(true);
    assert.equal(gi.claims, 1);
    const c = src.current();
    assert.equal(c.controllerKey, 'Rock Band Drums#1');
    assert.equal(c.kind, 'kit');
    assert.equal(c.hasCymbals, true);
    assert.equal(c.claimed, true);
    assert.equal(c.connected, true);
}));

test('claims only while wanted; setWanted(false) releases (claimCount 0) and parks current()', () => withStorage(() => {
    const { gi, src } = harness([XBOX]);
    assert.equal(src.current(), null);
    assert.equal(gi.claimCount, 0);
    src.setWanted(true);
    assert.equal(gi.claimCount, 1);
    assert.equal(src.current().claimed, true);
    src.setWanted(false);
    assert.equal(gi.claimCount, 0);
    const p = src.current();
    assert.equal(p.claimed, false);
    assert.equal(p.controllerKey, 'Xbox#1');
    assert.equal(p.kind, 'gamepad');
    assert.equal(p.hasCymbals, false);
    src.setWanted(true);
    assert.equal(gi.claimCount, 1);
    assert.equal(src.current().claimed, true);
    G.saveBinding('Xbox#1', { kind: 'kit', map: { red_pad: { type: 'button', index: 1 }, yellow_cymbal: { type: 'button', index: 2 } } });
    src.setWanted(false);
    src.refresh();   // a binding saved while parked updates what current() reports
    assert.equal(src.current().hasCymbals, true);
    assert.equal(src.current().claimed, false);
    src.setKey('Xbox#2');   // a different key clears the park
    assert.equal(src.current(), null);
}));

test('pinned mode claims only its key with a free standard pad in slot 0', () => withStorage(() => {
    G.saveBinding('Rock Band Drums#1', kitBinding);
    const { gi, src } = harness([XBOX, KIT]);
    src.setKey('Rock Band Drums#1');
    src.setWanted(true);
    assert.equal(gi.claims, 1);
    assert.equal(src.current().controllerKey, 'Rock Band Drums#1');
    const other = harness([XBOX]);
    other.src.setKey('Missing#1');
    other.src.setWanted(true);
    assert.equal(other.gi.claimCount, 0);
    assert.equal(other.src.current(), null);
}));

test('pads claimed by another owner are skipped', () => withStorage(() => {
    const { gi, src } = harness([XBOX, { id: 'Xbox', mapping: 'standard' }], { foreign: [0] });
    src.setWanted(true);
    assert.equal(gi.claims, 1);
    assert.equal(src.current().controllerKey, 'Xbox#2');
}));

test('LT press hits blue with cymbal false and the event time in ms', () => withStorage(() => {
    const { gi, src, calls } = harness([XBOX]);
    src.setWanted(true);
    gi.button(6, 1, 0, 2.25);
    assert.deepEqual(calls.hits, [[3, false, 2250]]);
    gi.button(6, 0, 0, 2.3);
    assert.equal(calls.hits.length, 1);
}));

test("a kit's yellow_cymbal hits yellow with cymbal true; its pad hits stay pads", () => withStorage(() => {
    G.saveBinding('Rock Band Drums#1', kitBinding);
    const { gi, src, calls } = harness([KIT]);
    src.setWanted(true);
    gi.button(6, 1, 0, 1);
    gi.button(2, 1, 0, 1.1);
    assert.deepEqual(calls.hits, [[2, true, 1000], [2, false, 1100]]);
}));

test('Y activates; Start pauses; releases do nothing', () => withStorage(() => {
    const { gi, src, calls } = harness([XBOX]);
    src.setWanted(true);
    gi.button(3, 1, 0, 3);
    gi.button(3, 0, 0, 3.1);
    gi.button(9, 1);
    gi.button(9, 0);
    assert.deepEqual(calls.activate, [3000]);
    assert.equal(calls.pause, 1);
    assert.equal(calls.hits.length, 0);
}));

test('disconnect then reconnect resumes the same handle; never stuck: the next pull presses and its release releases', () => withStorage(() => {
    const { gi, src, calls } = harness([XBOX]);
    src.setWanted(true);
    gi.button(7, 1);   // RT held
    assert.equal(calls.hits.length, 1);
    gi.change('disconnect', 0);
    assert.equal(src.current().connected, false);
    assert.equal(src.current().claimed, true);
    gi.change('connect', 0);
    assert.equal(src.current().connected, true);
    assert.equal(gi.claims, 1);
    assert.equal(calls.change, 2);
    gi.button(7, 1);   // core keeps old values: the held trigger reads as a fresh press
    assert.equal(calls.hits.length, 2);
    gi.button(7, 0);
    gi.button(7, 1);   // its release released, so the next pull hits again
    assert.equal(calls.hits.length, 3);
}));

test('refresh picks up a new binding', () => withStorage(() => {
    const { gi, src, calls } = harness([KIT]);
    src.setWanted(true);
    assert.equal(src.current(), null);   // an unset kit is not claimable
    G.saveBinding('Rock Band Drums#1', kitBinding);
    src.refresh();
    assert.equal(src.current().kind, 'kit');
    G.saveBinding('Rock Band Drums#1', { kind: 'kit', map: { red_pad: { type: 'button', index: 9 } } });
    src.refresh();
    assert.equal(src.current().hasCymbals, false);
    gi.button(9, 1);
    assert.deepEqual(calls.hits.map((h) => h[0]), [1]);
    G.forgetBinding('Rock Band Drums#1');
    src.refresh();
    assert.equal(src.current(), null);
    assert.equal(gi.claimCount, 0);
}));

test('a controller connecting later is claimed while wanted', () => withStorage(() => {
    const pads = [{ id: 'Xbox', mapping: 'standard', connected: false }];
    const { gi, src, calls } = harness(pads);
    src.setWanted(true);
    assert.equal(src.current(), null);
    pads[0].connected = true;
    gi.change('connect', 0);
    assert.equal(src.current().claimed, true);
    assert.equal(calls.change, 1);
}));

test('no gamepadInput: current() null, setWanted is a no-op', () => {
    const { src } = harness([], { noGi: true });
    assert.doesNotThrow(() => { src.setWanted(true); src.setKey('x'); src.refresh(); src.destroy(); });
    assert.equal(src.current(), null);
});

test('destroy releases and unsubscribes', () => withStorage(() => {
    const { gi, src } = harness([XBOX]);
    src.setWanted(true);
    src.destroy();
    assert.equal(gi.claimCount, 0);
    assert.equal(gi.changeFns.length, 0);
    assert.equal(src.current(), null);
    src.setWanted(true);
    assert.equal(gi.claimCount, 0);
}));

test('back-hold: pinned, held 1000 ms fires onBackHold once', () => withStorage(() => {
    assert.equal(S.BACK_HOLD_MS, 1000);
    const { gi, src, calls, timers } = harness([XBOX]);
    src.setKey('Xbox#1');
    src.setWanted(true);
    gi.button(8, 1);
    gi.button(8, 1);   // a repeat does not re-arm
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 1000);
    assert.equal(calls.back, 0);
    timers[0].fn();
    assert.equal(calls.back, 1);
    gi.button(8, 0);
    assert.equal(calls.back, 1);
    assert.equal(calls.hits.length, 0);   // Back is not a drum action
}));

test('back-hold: releasing early cancels; disconnect, setWanted(false) and destroy clear the timer', () => withStorage(() => {
    const h = harness([XBOX]);
    h.src.setKey('Xbox#1');
    h.src.setWanted(true);
    h.gi.button(8, 1); h.gi.button(8, 0);
    assert.equal(h.timers[0].live, false);
    h.gi.button(8, 1);
    h.gi.change('disconnect', 0);
    assert.equal(h.timers[1].live, false);
    h.gi.change('connect', 0);
    h.gi.button(8, 1);
    h.src.setWanted(false);
    assert.equal(h.timers[2].live, false);
    h.src.setWanted(true);
    h.gi.button(8, 1);
    h.src.destroy();
    assert.equal(h.timers[3].live, false);
    assert.equal(h.calls.back, 0);
}));

test('back-hold: free mode never fires, nor does a non-standard controller', () => withStorage(() => {
    const free = harness([XBOX]);
    free.src.setWanted(true);
    free.gi.button(8, 1);
    assert.equal(free.timers.length, 0);
    G.saveBinding('Rock Band Drums#1', kitBinding);
    const kit = harness([KIT]);
    kit.src.setKey('Rock Band Drums#1');
    kit.src.setWanted(true);
    kit.gi.button(8, 1);
    assert.equal(kit.timers.length, 0);
}));

test('a stored action that is not a pad action (e.g. "constructor") is no hit', () => withStorage(() => {
    G.saveBinding('Rock Band Drums#1', { kind: 'kit', map: {
        constructor: { type: 'button', index: 1 }, toString: { type: 'button', index: 2 }, kick: { type: 'button', index: 3 },
    } });
    const { gi, src, calls } = harness([KIT]);
    src.setWanted(true);
    gi.button(1, 1, 0, 1);
    gi.button(2, 1, 0, 1.1);
    gi.button(3, 1, 0, 1.2);
    assert.deepEqual(calls.hits, [[0, false, 1200]]);
}));

test('current().standardLayout: true for the built-in pad layout, false for a stored binding (also parked)', () => withStorage(() => {
    const { src } = harness([XBOX]);
    src.setWanted(true);
    assert.equal(src.current().standardLayout, true);
    src.setWanted(false);
    assert.equal(src.current().standardLayout, true);
    G.saveBinding('Rock Band Drums#1', kitBinding);
    const k = harness([KIT]);
    k.src.setWanted(true);
    assert.equal(k.src.current().standardLayout, false);
}));
