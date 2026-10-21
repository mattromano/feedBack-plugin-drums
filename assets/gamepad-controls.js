/*
 * gamepad-controls.js: the Controllers card on the feedBack drums plugin's screen: controller
 * setup (drum kit or gamepad layout), rebinding and the per-controller input offset.
 * Copyright (c) the feedBack drums plugin contributors. MIT license (see README.md).
 *
 *   DrumsGamepadControls.create({ G, gamepadInput, list, owner, isPinned(key), onBindingSaved(key),
 *                                 onOffsetSaved(key, ms) }) -> { refresh(), destroy() }
 *
 * G is DrumsGamepad; list is the element the controller cards go in. While it exists it claims every
 * free connected controller as `owner` (never one another owner holds, and never one isPinned(key)
 * names: a band lane's), lights each card's pads from the claim's events (event-driven, cached
 * elements, no DOM queries) and saves bindings through G, calling onBindingSaved after each. The
 * input offset is handed to onOffsetSaved (already clamped): the caller stores it. The lights are
 * silent: nothing here makes sound.
 *
 * Modelled on the feedBack five-fret plugin's assets/controls.js at commit 686bb98 (MIT, same
 * author), without its calibration.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) window.DrumsGamepadControls = api;
    else if (typeof module !== 'object' && root) root.DrumsGamepadControls = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const OFFSET_MIN = -250, OFFSET_MAX = 250, OFFSET_STEP = 5;
    const ACTION_LABELS = {
        red_pad: 'Red', yellow_pad: 'Yellow', blue_pad: 'Blue', green_pad: 'Green', kick: 'Kick',
        yellow_cymbal: 'Yellow cymbal', blue_cymbal: 'Blue cymbal', green_cymbal: 'Green cymbal',
        star_power: 'Star power', pause: 'Pause',
    };
    const PROMPTS = {
        red_pad: 'Hit the red pad', yellow_pad: 'Hit the yellow pad', blue_pad: 'Hit the blue pad',
        green_pad: 'Hit the green pad', kick: 'Press the kick pedal',
        yellow_cymbal: 'Hit the yellow cymbal', blue_cymbal: 'Hit the blue cymbal', green_cymbal: 'Hit the green cymbal',
        star_power: 'Press Star power (a button)', pause: 'Press Start (pause)',
    };
    const LIGHT_COLORS = {
        red_pad: '#e53935', yellow_pad: '#fdd835', blue_pad: '#1e88e5', green_pad: '#43a047', kick: '#fb8c00',
        yellow_cymbal: '#fdd835', blue_cymbal: '#1e88e5', green_cymbal: '#43a047',
    };
    const LIGHT_DEFAULT = '#0ea5e9';
    const CHIP_STYLE = 'display:inline-block;min-width:2.2rem;text-align:center;padding:2px 6px;border-radius:6px;'
        + 'font-size:11px;border:1px solid #2a3150;color:#9ca3af;';
    const CONTROLS_OWNER = 'drums.controls';

    // The pure helpers use DrumsGamepad (Node: the sibling file; the page: its global).
    function gamepad() {
        if (typeof window !== 'undefined' && window && window.DrumsGamepad) return window.DrumsGamepad;
        if (typeof module === 'object' && module && typeof require === 'function') return require('./gamepad.js');
        return null;
    }

    // -250..250 ms, in steps of 5.
    function clampOffset(ms) {
        const v = Number(ms);
        if (!Number.isFinite(v)) return 0;
        return Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, Math.round(v / OFFSET_STEP) * OFFSET_STEP)) + 0;   // + 0: no -0
    }

    // What one controller's card shows. binding: the controller's resolved binding (stored, else
    // the standard layout for a standard pad), or null.
    function cardModel({ info, nth, binding, offsetMs }) {
        const G = gamepad();
        const key = (info && typeof info.controllerKey === 'string' && info.controllerKey) || G.controllerKey(info, nth);
        const kindLabel = !binding ? 'Needs setup' : binding.kind === 'kit' ? 'Drum kit' : 'Xbox-style gamepad';
        return {
            key,
            name: G.controllerName(info && info.id, nth),
            kindLabel,
            needsSetup: !binding,
            hasCymbals: !!binding && G.hasCymbals(binding),
            offsetMs: Number.isFinite(offsetMs) ? clampOffset(offsetMs) : 0,
        };
    }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function button(label, dr, onClick) {
        const b = el('button', 'dr-btn', label);
        b.type = 'button';
        b.dataset.dr = dr;
        b.addEventListener('click', onClick);
        return b;
    }
    function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
    // A light writes only when its state changes.
    function setOn(chip, on) {
        const v = on ? '1' : '0';
        if (chip.dataset.on === v) return;
        chip.dataset.on = v;
        const color = chip.dataset.color;
        chip.style.background = on ? color : '';
        chip.style.borderColor = on ? color : '';
        chip.style.color = on ? (color === '#fdd835' ? '#111' : '#fff') : '';
    }
    function note(text) {
        const p = el('p', 'dr-d', text);
        p.dataset.dr = 'padNote';
        return p;
    }
    // The browser's own state of one controller (axis rests), or null.
    function browserPad(index) {
        try {
            const nav = window.navigator;
            const pads = nav && typeof nav.getGamepads === 'function' ? nav.getGamepads() : null;
            return pads && pads[index] ? pads[index] : null;
        } catch (_) { return null; }
    }

    function create(opts) {
        const G = opts.G;
        const gi = opts.gamepadInput || null;
        const list = opts.list;
        const owner = opts.owner || CONTROLS_OWNER;
        const isPinned = typeof opts.isPinned === 'function' ? opts.isPinned : () => false;
        const onBindingSaved = typeof opts.onBindingSaved === 'function' ? opts.onBindingSaved : () => {};
        const onOffsetSaved = typeof opts.onOffsetSaved === 'function' ? opts.onOffsetSaved : () => {};
        let cards = [];
        let busy = false;      // our own claim/release: ignore the change events they fire
        let destroyed = false;

        if (!gi) {
            list.replaceChildren(note('Controllers need a newer feedBack.'));
            return { refresh() {}, destroy() { destroyed = true; list.replaceChildren(); } };
        }

        function claim(index) {
            busy = true;
            try { return gi.claim(index, owner); } catch (_) { return null; } finally { busy = false; }
        }
        function release(handle) {
            busy = true;
            try { handle.release(); } catch (_) { /* ignore */ } finally { busy = false; }
        }

        // ── One card ──

        function refreshCard(card) {
            const m = cardModel({ info: card.info, nth: card.nth, binding: card.binding, offsetMs: 0 });
            setText(card.kind, m.kindLabel);
            setText(card.cymbals, 'Cymbals: ' + (m.hasCymbals ? 'on' : 'off'));
            card.rebind.disabled = !card.binding || !!card.recorder;
            card.setupKit.disabled = !!card.recorder;
            card.useGamepad.disabled = !!card.recorder;
            card.layoutNote.hidden = !m.needsSetup;
        }
        function setPrompt(card, text) {
            setText(card.promptText, text || '');
            card.prompt.hidden = !text;
            card.skip.hidden = !card.recorder || !G.OPTIONAL_ACTIONS.includes(card.recorder.next);
        }
        function promptFor(action) { return PROMPTS[action] || ('Press ' + (ACTION_LABELS[action] || action)); }

        function startRecording(card, kind, actions, single) {
            const pad = browserPad(card.info.index);
            const rest = {};
            if (pad && pad.axes) for (let i = 0; i < pad.axes.length; i++) rest[i] = Number(pad.axes[i]) || 0;
            const used = [];
            if (single && card.binding) {
                for (const a of Object.keys(card.binding.map)) if (a !== single) used.push(card.binding.map[a]);
            }
            card.recorder = G.createSetupRecorder(actions, { rest, used });
            card.recording = { kind, single };
            refreshCard(card);
            setPrompt(card, promptFor(card.recorder.next));
        }
        function endRecording(card, text) {
            card.recorder = null;
            card.recording = null;
            setPrompt(card, null);
            refreshCard(card);
            setText(card.status, text || '');
        }
        function recorderStep(card, r) {
            if (!r.done) { setPrompt(card, promptFor(r.next)); return; }
            const mode = card.recording;
            if (!Object.keys(r.binding.map).length) { endRecording(card, 'Nothing recorded, so nothing was saved.'); return; }
            const merge = mode.single && card.binding;
            const binding = {
                kind: merge ? card.binding.kind : mode.kind,
                map: merge ? Object.assign({}, card.binding.map, r.binding.map) : r.binding.map,
            };
            if (!G.saveBinding(card.key, binding)) { endRecording(card, 'Could not save: browser storage is unavailable.'); return; }
            card.binding = binding;
            card.mapper = G.createMapper(binding);
            endRecording(card, 'Saved.');
            onBindingSaved(card.key);
        }
        function useGamepadLayout(card) {
            if (card.info.mapping === 'standard') {
                if (!G.forgetBinding(card.key)) { setText(card.status, 'Could not save: browser storage is unavailable.'); return; }
                card.binding = G.resolveBinding(card.info, undefined);
                card.mapper = card.binding ? G.createMapper(card.binding) : null;
                refreshCard(card);
                setText(card.status, 'Using the standard gamepad layout.');
                onBindingSaved(card.key);
                return;
            }
            startRecording(card, 'gamepad', G.SETUP_ACTIONS.gamepad, null);
        }

        function onOffsetChange(card) {
            const v = Number(card.offset.value);
            if (card.offset.value === '' || !Number.isFinite(v)) {
                card.offset.value = String(G.loadSettings().offsetMs[card.key] || 0);
                return;
            }
            const ms = clampOffset(v);
            card.offset.value = String(ms);
            onOffsetSaved(card.key, ms);
        }

        function onCardEvent(card, ev) {
            if (!ev) return;
            if (card.mapper) {
                const out = card.mapper.map(ev);
                for (let i = 0; i < out.length; i++) {
                    const chip = card.lights[out[i].action];
                    if (chip) setOn(chip, !!out[i].value);
                }
            }
            if (card.recorder) {
                const r = card.recorder.feed(ev);
                if (r.recorded || r.done) recorderStep(card, r);
            }
        }

        function buildCard(info, nth, key, bindings, settings) {
            const card = {
                info, nth, key, handle: null, claimedBy: null, binding: G.resolveBinding(info, bindings[key]),
                mapper: null, lights: {}, recorder: null, recording: null, onEvent: null,
            };
            const h = claim(info.index);
            if (!h) return null;   // taken between list() and claim()
            card.handle = h;
            card.claimedBy = owner;
            card.mapper = card.binding ? G.createMapper(card.binding) : null;
            const m = cardModel({ info, nth, binding: card.binding, offsetMs: settings.offsetMs[key] });

            const root = el('div', '');
            root.style.cssText = 'border-top:1px solid #1f2937;padding:.7rem 0;';
            root.dataset.dr = 'padCard';
            const head = el('div', '');
            head.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;';
            const name = el('div', 'dr-t', m.name);
            name.dataset.dr = 'padName';
            card.kind = el('span', 'dr-d');
            card.kind.dataset.dr = 'padKind';
            card.cymbals = el('span', 'dr-d');
            card.cymbals.dataset.dr = 'padCymbals';
            head.append(name, card.kind, card.cymbals);

            const lights = el('div', '');
            lights.style.cssText = 'display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.5rem;';
            for (const a of G.ACTIONS) {
                const chip = el('span', '', ACTION_LABELS[a] || a);
                chip.style.cssText = CHIP_STYLE;
                chip.dataset.dr = 'light-' + a;
                chip.dataset.on = '0';
                chip.dataset.color = LIGHT_COLORS[a] || LIGHT_DEFAULT;
                card.lights[a] = chip;
                lights.appendChild(chip);
            }

            const setupRow = el('div', '');
            setupRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.6rem;';
            card.setupKit = button('Set up as drum kit', 'setupKit', () => startRecording(card, 'kit', G.SETUP_ACTIONS.kit, null));
            card.useGamepad = button('Use gamepad layout', 'useGamepad', () => useGamepadLayout(card));
            setupRow.append(card.setupKit, card.useGamepad);
            card.layoutNote = el('div', 'dr-d', 'Not set up: choose Set up as drum kit, or Use gamepad layout.');
            card.layoutNote.dataset.dr = 'padSetupNote';

            card.prompt = el('div', '');
            card.prompt.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.5rem;';
            card.prompt.dataset.dr = 'padPrompt';
            card.promptText = el('span', 'dr-t');
            card.promptText.dataset.dr = 'padPromptText';
            card.skip = button('Skip', 'padSkip', () => { if (card.recorder) recorderStep(card, card.recorder.skip()); });
            card.prompt.append(card.promptText, card.skip,
                button('Cancel', 'padCancel', () => { if (card.recorder) endRecording(card, 'Setup cancelled.'); }));
            card.prompt.hidden = true;

            const rebindRow = el('div', '');
            rebindRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.5rem;';
            card.rebindAction = el('select');
            card.rebindAction.dataset.dr = 'padRebindAction';
            card.rebindAction.setAttribute('aria-label', 'Action to rebind');
            for (const a of G.ACTIONS) {
                const o = el('option', '', ACTION_LABELS[a] || a);
                o.value = a;
                card.rebindAction.appendChild(o);
            }
            card.rebindAction.value = G.ACTIONS[0];
            card.rebind = button('Rebind', 'padRebind', () => {
                const a = card.rebindAction.value;
                if (card.binding && ACTION_LABELS[a]) startRecording(card, card.binding.kind, [a], a);
            });
            rebindRow.append(el('span', 'dr-d', 'Rebind'), card.rebindAction, card.rebind);

            const offsetRow = el('div', '');
            offsetRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.5rem;';
            card.offset = el('input');
            card.offset.type = 'number';
            card.offset.min = String(OFFSET_MIN);
            card.offset.max = String(OFFSET_MAX);
            card.offset.step = String(OFFSET_STEP);
            card.offset.value = String(m.offsetMs);
            card.offset.dataset.dr = 'padOffset';
            card.offset.setAttribute('aria-label', 'Input offset in milliseconds');
            card.offset.addEventListener('change', () => onOffsetChange(card));
            offsetRow.append(el('span', 'dr-d', 'Input offset (ms)'), card.offset);

            card.status = el('div', 'dr-d');
            card.status.dataset.dr = 'padStatus';

            root.append(head, lights, setupRow, card.layoutNote, card.prompt, rebindRow, offsetRow, card.status);
            card.el = root;
            refreshCard(card);
            card.onEvent = (ev) => onCardEvent(card, ev);
            h.addListener(card.onEvent);
            return card;
        }

        // Stop what the card started and release its claim.
        function disposeCard(card) {
            card.recorder = null;
            if (card.handle) {
                try { card.handle.removeListener(card.onEvent); } catch (_) { /* ignore */ }
                release(card.handle);
                card.handle = null;
            }
        }

        // Bring the cards in line with the connected controllers. A card stays (claim, setup and all)
        // while its controller is connected in its slot; cards for controllers that left go; new or
        // newly free controllers get a card. Controllers held by another owner or pinned to a band
        // lane get none.
        function refresh() {
            if (destroyed) return;
            let infos = [];
            try { infos = gi.list() || []; } catch (_) { infos = []; }
            const bindings = G.loadBindings();
            const settings = G.loadSettings();
            const nth = Object.create(null);
            const old = cards.slice();
            const next = [];
            let connected = 0;
            for (const info of infos) {
                if (!info || !info.connected) continue;
                connected++;
                nth[info.id] = (nth[info.id] || 0) + 1;
                const key = (typeof info.controllerKey === 'string' && info.controllerKey) || G.controllerKey(info, nth[info.id]);
                if (isPinned(key)) continue;
                if (info.claimedBy && info.claimedBy !== owner) continue;
                const at = old.findIndex((c) => c.handle && c.handle.index === info.index && c.info.id === info.id
                    && c.nth === nth[info.id]);
                if (at >= 0) { next.push(old[at]); old.splice(at, 1); continue; }
                next.push({ info, n: nth[info.id], key });   // built below, after the cards that left release
            }
            for (const c of old) disposeCard(c);
            const built = [];
            for (const x of next) {
                if (x.el) { built.push(x); continue; }
                const c = buildCard(x.info, x.n, x.key, bindings, settings);
                if (c) built.push(c);
            }
            cards = built;
            if (cards.length) list.replaceChildren(...cards.map((c) => c.el));
            else {
                list.replaceChildren(note(connected
                    ? 'The connected controllers are in use right now.'
                    : 'No controllers connected. Connect one and press any button on it.'));
            }
        }

        // Controllers came, went, or someone claimed or released one.
        const offChange = typeof gi.on === 'function' ? gi.on('change', (ev) => { if (!busy && ev) refresh(); }) : null;

        refresh();
        return {
            refresh,
            destroy() {
                if (destroyed) return;
                destroyed = true;
                try { if (typeof offChange === 'function') offChange(); } catch (_) { /* ignore */ }
                for (const c of cards) disposeCard(c);
                cards = [];
                list.replaceChildren();
            },
        };
    }

    return { create, cardModel, clampOffset, OFFSET_MIN, OFFSET_MAX, OFFSET_STEP, CONTROLS_OWNER };
});
