# Slopsmith Plugin: Drum Highway

![Drum Highway](screenshot.png)

A plugin for [Slopsmith](https://github.com/got-feedback/feedback) that replaces the guitar highway with a lane-based drum view, with MIDI drum pad input and a built-in drum kit synthesizer.

## Features

- **Lane-based drum highway** — 8 horizontal lanes (Hi-Hat, Snare, Tom 1-3, Crash, Ride, Kick) with notes scrolling right to left
- **Kick drum full-width bars** — kick hits render as wide horizontal bars spanning the highway, like open string notes on the guitar highway
- **Distinct note shapes** — circles for toms/snare, diamonds for cymbals, X shapes for hi-hat, full bars for kick
- **Hi-hat variations** — closed (filled X), pedal (small X at bottom), open (ring with "o" inside)
- **Neon glow effects** — each drum piece has a unique color with multi-layer glow
- **Velocity-based sizing** — louder hits are bigger, ghost notes are smaller
- **Auto-activate** — switches on automatically for Drums/Percussion arrangements
- **MIDI drum pad input** — connect any MIDI drum pad, electronic kit, or controller via Web MIDI API
- **Custom MIDI mapping** — "Learn" mode to assign any MIDI note to any lane, for non-standard drum pads
- **Built-in drum sounds** — six kits, all bundled (works offline): two real multi-sampled acoustic kits with velocity layers, **Crocell** (rock, default) and **Virtuosity** (jazz), and four WebAudioFont GM kits (JCLive, FluidR3 GM, Sound Blaster Live!, Chaos), balanced and dynamic, through a stereo room; plus the multi-mic **DRS** kit when built locally. See [Drum kits](#drum-kits).
- **Tight timing** — hits are timed by the MIDI message's arrival on the audio clock, a frame-exact highway clock, and an early/late meter with a suggested input offset. See [Timing](#timing).
- **Split view** — kit hits reach the drum panel on screen, each panel keeps its own difficulty. See [Split view](#split-view).
- **Hi-hat pedal (CC4)**, **Clone Hero kit map**, **MIDI monitor** and, on Windows, **direct MIDI input** when the browser can't see the kit. See [Your kit](#your-kit).
- **Rock Band-style 3D drum track** (default with WebGL2) — four pad lanes and a kick bar, rectangle pad gems, domed cymbals, star power and fill highlighting, and a score HUD. See [3D view](#3d-view).
- **Keyboard drumming** — play without a kit: B kick, F snare, J/K/L toms, U/I/O cymbals, Enter = star power.
- **Rock Band-style scoring** — score, multiplier, streak, stars and star power from a port of the YARG drums engine (`assets/engine.js`). See [Scoring](#scoring).
- **Difficulty** — Easy, Medium, Hard, Expert or Expert+ per player (browser), changeable mid-song. See [Difficulty](#difficulty).
- **Assists** — auto kick, auto cymbals (each up to a chosen difficulty) and hit-timing presets. See [Assists](#assists).
- **Inline settings** — MIDI device, volume, channel filter, lane labels, hit detection, and mapping table
- **Drums settings page** — Plugins → **Drums**: every drum setting on one page, a pad tester for your kit and your best scores. See [Settings page](#settings-page).
- **End-of-song card** — final score, stars, accuracy, streak and where the points came from, with your best score per song and difficulty.

## Drum Lanes

| Lane | Label | MIDI Notes | Color | Shape |
|------|-------|-----------|-------|-------|
| Hi-Hat | HH | 42, 44, 46 | Blue | X |
| Snare | Sn | 38, 40 | Yellow | Circle |
| Tom 1 | T1 | 48, 50 | Green | Circle |
| Tom 2 | T2 | 45, 47 | Orange | Circle |
| Tom 3 | T3 | 41, 43 | Purple | Circle |
| Crash | Cr | 49, 57 | Cyan | Diamond |
| Ride | Ri | 51, 59 | White | Diamond |
| Kick | Ki | 35, 36 | Red | Full-width bar |

## 3D view

The 3D view is a WebGL renderer (`assets/highway3d.js`, on the three.js copy that ships with feedBack core)
in the style of the classic drum games:

- **Lanes** — red, yellow, blue and green pad lanes plus an orange kick bar across the track; rectangular
  pad targets in the lane colours sit on the strikeline.
- **Gems** — snare and toms are bevelled rounded-rectangle blocks, cymbals (hi-hat, ride, crash) are raised
  domes, kicks are flat orange bars (double kicks magenta with a white stripe). Accents are bigger and
  brighter, ghost notes smaller and translucent.
- **Feedback** — hit gems turn green and missed gems red, carry on past the strikeline and fade out over
  0.4 s. A hit flashes its target and lane (green on time, cyan early, amber late) and throws sparks that
  grow with the streak; a miss or a hit on an empty lane flashes the lane red. Each hit pops its points,
  every 10 in a row rings out, 25 / 50 / 100 streaks burst, and a broken streak washes the screen red.
  Beat and measure lines scroll with the chart; drum solos tint the track violet.
- **Star power** — phrase notes are silver-white; with half a meter the fills are marked green and the note
  that ends the fill gets a spinning ring. While active the track edges glow blue and the multiplier doubles.
- **HUD** — streak and multiplier left of the track; star power meter, score, stars, accuracy and the
  difficulty badge (click it, or D / Shift+D) right of it. Core draw hooks
  (`window.highway.fireDrawHooks`) run on the HUD canvas, so overlay plugins still work.

### Choosing the view

The plugin registers one picker entry, **Drum Highway** (`window.feedBackViz_drums`), which Auto mode picks
for drum parts. Each renderer it creates reads the **View** setting in the settings panel (gear):

- **Auto** (default) — 3D when WebGL2 is available, otherwise 2D.
- **3D** / **2D** — always that view (3D still falls back to 2D without WebGL2).

Changing it swaps the renderer in the main player right away; splitscreen panels pick it up the next time
their renderer is created. `window.feedBackViz_drums3d` / `feedBackViz_drums2d` are exported for hosts
that want one view regardless of the setting (not in the picker).

### Keyboard

**Keys** (on by default) lets you play with the keyboard in either view:

| Key | Pad |
|---|---|
| B | kick |
| F | red (snare) |
| J / K / L | yellow / blue / green tom |
| Shift+J/K/L, or U / I / O | yellow / blue / green cymbal |
| Enter | activate star power (when the chart has no fills) |

The keys work only while the drum view is visible and focused (in splitscreen: the focused panel), and not
while you type in a text field. Space stays play/pause; D / Shift+D change the difficulty.

## Scoring

Turn on **Score** in the settings panel (gear) to see the scoring HUD: multiplier, score, streak, stars
and the star power meter. Hit notes turn green, missed notes grey, and a pad hit on an empty lane flashes it
red.

Scoring is a JavaScript port of YARG.Core's drums engine (`assets/engine.js`, LGPL-3.0 — see
[License](#license)), used through `assets/session.js`:

- **Hit window** ±70 ms (see [Assists](#assists) for wider ones); one pad hit hits at most one note.
- **Multiplier** grows every 10 notes up to x4, doubled during star power (x8). 60 points per note (pro
  drums), plus a dynamics bonus for hitting an accent hard or a ghost note soft (needs a velocity-sensitive
  kit). Pro drums: a cymbal and the tom of the same colour are different notes; with **Pro cymbals** off
  either one hits that colour's notes.
- **Star power** — notes in a star power phrase are drawn silver-white; hitting every note of a phrase fills
  a quarter of the meter. With half a meter, the chart's **fills** are marked green: the hit that ends the
  fill activates star power.
- **Bonuses** (shown in the score) — +10 x multiplier for a hit within 25 ms, extra points for snare / tom
  rolls, and a drum-solo bonus (100 per note hit, doubled for a perfect solo) with a live percentage during
  a solo.
- **Offset** (ms) — subtracted from the time of every hit and from the scoring clock alike; raise it if
  your hits register late (audio or MIDI latency). The 3D HUD's timing meter suggests a value (see
  [Timing](#timing)).
- **Star power pad** — on charts with star power phrases but no fills, star power is activated with Enter
  or this pad (off by default; the pad then doesn't score as a note).
- Seeking (or a loop jumping back) restarts scoring from the new position; skipped notes aren't misses.

The scoring files load on first use from core's plugin assets route (`/api/plugins/drums/assets/`). Until
they have loaded the view shows the chart as it is.

### Difficulty

Each player picks **Easy**, **Medium**, **Hard**, **Expert** or **Expert+**, stored per browser
(`localStorage` key `drums_difficulty_v1`, default Expert), so in splitscreen / multiplayer every player
keeps their own. Change it in the settings panel, by clicking the difficulty badge (top-left of the lanes),
or with **D** (harder) / **Shift+D** (easier) while the view is focused.

- **Expert+** is the drum part as charted, double kicks included; **Expert** drops the double-kick notes
  (`x2`). **Easy / Medium / Hard** come from the chart's own easier levels; the badge says **AUTO** when a
  level was reduced by software rather than hand-charted.
- A level the chart doesn't have is greyed out with the reason; a song without your saved level plays
  Expert (the badge is dimmed) and your choice is kept for the next song.
- Changing difficulty mid-song rebuilds the chart from the current position, like a seek.

### Where star power, fills and levels come from

They are part of the song's drum tab (`drum_tab.json`, feedpak 1.20.0 "drum gameplay metadata"): per-hit
`a` (accent) and `x2` (double kick) flags, `star_power` / `fills` / `solos` as `{start_time, end_time}`
ranges, and `levels.easy|medium|hard` with their own `hits` and a `generated` marker. feedBack's Rock Band /
Clone Hero / YARG chart importer writes them, and core streams them to the plugin with the tab
(`bundle.drumTab`). A tab without them — an older tab, a core that doesn't stream them yet, or drums encoded
as guitar notes — plays **Expert only, without star power**; everything else works the same.

### Assists

- **Auto kick / Auto cymbals** (`drums_auto_kick_v1`, `drums_auto_cymbals_v1`): `Off`, `Easy only`,
  `Easy – Medium`, `Easy – Hard` or `Every difficulty` — the assist is on at that difficulty and the ones
  below it. Those notes are left out of scoring, marked as played when they reach the now line, and pad hits
  on them are ignored. Cymbals = the chart's hi-hat, ride and crash notes. They are **played on the drum
  sound** (scheduled ~60 ms ahead on the audio clock) so muting the drum stem leaves no holes, at their own
  **Auto vol** (`drums_auto_volume_v1`, default 80%), so pads can stay silent when the kit module makes the
  sound.
- **Timing** (`drums_timing_v1`): Relaxed ±130 ms, Forgiving ±100 ms, Normal ±70 ms (YARG's default),
  Precision (YARG's dynamic window that tightens on fast notes).

### Timing

- **Hit time** — a pad hit is timed when its MIDI message arrived (the listener's timestamp), on the audio
  clock: the playhead now plus this highway's chart / A/V offset (`window.__hwtRenderOffset` from highway
  tweaks when present), minus how long ago the message arrived. Without it the frame clock is extrapolated
  to now, minus the same arrival lag. Keyboard hits use the key event's timestamp.
- **Input grace** — the engine runs 60 ms behind the frame clock (`session.js` `INPUT_GRACE`), so a hit struck
  before the last frame but delivered after it keeps its own time (YARG's input queue used to move it to the
  frame: measured +9 ms late). Misses become final 60 ms later.
- **Frame clock** — both views draw from a frame-exact clock (`window.__hwtFrameTime` from highway tweaks when
  present; else the 60 Hz `bundle.currentTime` sample extrapolated to the draw, like core's 3D highway).
  Measured with the precise clock: per-frame step error sd 3.7 ms → 0.1 ms.
- **Timing meter** (3D HUD, under the difficulty badge) — your last 24 hits on a ±100 ms bar (blue early,
  orange late), their median, and after 6 hits the input offset that would centre them, with an **Apply**
  button.
- **Pad sounds** reach the ears tens of ms after the stick through Web Audio; for the tightest feel, set the
  volume to 0 and listen to the kit module.
- **Calibration hooks** for sync tools: every judged hit is a `drums:judgment` window event (`errMs`, + =
  late); `window.__drumsSetInputOffset(ms)`, `__drumsGetConfig()`, `__drumsRefreshParams()`,
  `__drumsSetPadVolume(v)`, `__drumsCalibrationWindow` (s, a wide fixed hit window) and `__drumsMutePads`.

### Split view

- Kit hits go to the focused drum panel when it is on screen, else to the first drum panel on screen.
- Each drum panel keeps its own difficulty (`drums_difficulty_panel<N>`), with a picker in the panel bar in
  place of the phrase-level slider. `window.__drumsPanelResults()` lists every panel's score for a results
  card; there is no single end card in split view.
- One drum highway: a Drums arrangement is offered once in a panel's picker, on the Drum Highway; a Drums
  part picked in another view moves to it, and a Drum Highway panel saved on Lead moves to the song's Drums.
  In the main player a Drums arrangement opened in a guitar view is shown on the Drum Highway for that song.
- A part that isn't drums (and no drum tab) plays nothing and says *Pick the Drums part* or *This song has
  no drums*, instead of reading guitar notes as drums.

## Drum kits

**Kit** in the settings panel (`drums_kit_v1`) picks the sound for pad hits and the auto notes; only the
chosen kit is loaded.

- **Crocell (rock)**, the default — a real sampled kit (CrocellKit, CC BY 4.0) with 4 velocity layers x 2
  round-robins per piece, so soft and hard hits sound different and repeated hits don't sound identical; a
  closed / pedal hi-hat cuts a ringing open hi-hat.
- **Virtuosity (jazz)** — the same kind of kit (Virtuosity Drums, CC0).
- **JCLive**, **FluidR3 GM**, **Sound Blaster Live!**, **Chaos** — WebAudioFont General MIDI kits, one
  sample per note.
- **DRS (studio, multi-mic)** — optional: DRSKit 2.1 mixed from its 13 microphones (close, overheads, real
  room), up to 8 velocity layers x 3 hits, semi-open hi-hat. Its samples are not in the repo (built from the
  2.8 GB source with `tools/build_drumgizmo_kit.py drs`); the picker lists it once
  `assets/sounds/kits/drs/kit.json` is there. The same script rebuilds Crocell from its 15 microphones.

How they sound:

- **Balance** — every piece is levelled by perceived loudness to a drum mix (kick 0, snare 0, toms −2, hats
  −6 / −4, ride −7, crash −5 dB): `kit.json` note gains for the sampled kits, `GM_NOTE_DB` for the GM kits.
- **Dynamics** — one velocity law for all kits (20 × 1.75 × log10(v / 127) dB: velocity 64 is −10 dB, 20 is
  −28 dB). Sampled layers are levelled onto it (`tools/kit_loudness.py`) and blended across layer
  boundaries, so tone changes with velocity without steps; GM kits get a darker low-pass on soft hits.
- **Velocity curve** (`drums_vel_curve_v1`): Linear, Soft (light hits come out stronger) or Hard.
- **Room** (`drums_room_v1`, default 35 %): a stereo room (convolution on a generated impulse response, RT60
  ~0.7 s) plus a gentle low shelf and presence lift; the mono GM kits are also panned piece by piece from the
  drummer's view. Only IIR filters sit on the dry path, so it adds no delay. Kits with their own room mics get
  half of it.
- Voice limit per piece (4 drums, 6 cymbals; the oldest fades out), natural cymbal decays, closed / pedal
  hi-hat chokes the open one, and a note the kit has no sound for plays its lane's sound (e.g. hi-hat hits
  some Alesis modules send as note 24). Sampled kits are playable once the first hit of every layer is
  decoded; the other round-robins load in the background.

Everything ships in `assets/sounds/` (about 12 MB, Ogg Vorbis for the sampled kits) and loads from core's
plugin assets route, so nothing comes from a CDN and the kits work offline. The sampled kits are fetched and
decoded when picked and play through plain `AudioBufferSourceNode`s for low latency. A missing kit folder
falls back to the default kit, then JCLive. Sources, licences and the build script: `assets/sounds/README.md`, `NOTICE.md`,
`tools/build_sample_kit.py`.

## Your kit

- **Clone Hero kit map** — the active Clone Hero MIDI profile on the computer running feedBack
  (`GET /api/plugins/drums/kit-mapping`; `CLONE_HERO_DIR`, `~/Documents/Clone Hero`, `~/Clone Hero` or
  `~/Library/Application Support/Clone Hero`) is the default pad map until you Learn one, with its per-note
  velocity thresholds. The mapping section says which map is in use.
- **Auto-connect** prefers the drum kit (the profile's device, or a drum-module name) over another device it
  picked by itself; a device you pick by hand, or None, is kept.
- **Hi-hat pedal** (`drums_hh_pedal_v1`, on by default) — the pedal position the kit sends as CC4. Modules
  that send separate closed (42) / open (46) notes are trusted, and a half-closed pedal turns an open hit
  into the kit's semi-open sound (note 23, multi-mic kits); modules that send one note get closed /
  semi-open / open from the pedal (≥ 85 % / 45–85 % / below). Closing the pedal chokes a ringing open hat,
  with a pedal chick when the kit never sends note 44. The CC4 direction is learnt from the 42 / 46 values.
- **MIDI monitor** (settings page) — records every raw message (notes, CC, aftertouch) with per-note velocity
  min / median / max; **Save log** appends it to `<config>/drums/midi_log.jsonl` (`POST
  /api/plugins/drums/midi-log`, this computer only).
- **Direct MIDI input (Windows)** — the Windows MIDI Service can hide the kit from Web MIDI. `native_midi.py`
  reads MIDI inputs through WinMM and `routes.py` streams them (`WS /ws/plugins/drums/midi`, this computer
  only, the device open only while a page listens); they are registered with core's midi-input domain and
  listed as "<name> · direct" when Web MIDI has no input of that name, with the driver's arrival times. On
  macOS / Linux nothing is loaded or registered.

## Settings page

**Plugins → Drums** (the plugin's `nav` entry) collects every drum setting on one page, grouped into
*Difficulty & assists*, *Drum sounds* (kit, **▶ Play test**, volume), *Your kit (MIDI)* and *Display &
controls*, plus:

- **MIDI status** — the device in use, how many hits arrived, the last note / velocity / channel, and why a
  hit was dropped (no drum view focused, channel filter) or why the device failed to open.
- **Pad tester** — hit your pads: the lane each one counts as lights up and the kit sound plays. **Learn**
  works here too (open *Pad mapping*, click Learn, hit the pad).
- **MIDI monitor** — see [Your kit](#your-kit).
- **Best scores** — your best score per song and difficulty.
- **Reset drum settings** — back to the defaults, keeping your MIDI input, pad mapping and scores.

The controls are the same per-browser settings as the ⚙ panel in the player and stay in sync with it.

## End-of-song card

When a song you played ends, a card shows the final score (engine score plus the timing, roll and solo
bonuses), stars, accuracy, notes hit, best streak or **FC**, and chips for where the points came from: notes ×
multiplier, star power, accents / ghosts, spot-on timing, rolls and drum solos. The best score per song and
difficulty is kept in this browser (`localStorage` key `drums_best_v1:<song>|<difficulty>`); a higher score
shows **NEW BEST SCORE**. Close it with the button, Esc or Enter; it also closes when the next song loads.
Watching a chart without playing it shows no card.

## Requirements

- **Chrome or Edge** for MIDI drum pad input (Firefox does not support Web MIDI)
- MIDI features are optional — the drum view works without a MIDI controller

## Installation

```bash
cd /path/to/slopsmith/plugins
git clone https://github.com/got-feedback/feedback-plugin-drums.git drums
docker compose restart
```

A "Drums" button will appear in the player controls when you play a song. Click the gear icon next to it to configure MIDI input and sound settings.

## How It Works

The plugin reads note data from the highway renderer and maps them to drum lanes. Notes use the MIDI encoding convention `midi = string * 24 + fret`, which the [editor plugin](https://github.com/got-feedback/feedback-plugin-editor) uses when importing drum tracks from Guitar Pro files.

### MIDI Drum Pad

Connect a USB MIDI drum pad or electronic kit and select it from the settings panel. Play along and get real-time visual feedback:

- **Lane flash** — the lane lights up when you hit the correct drum piece
- **Green notes** — correctly hit notes within the timing window
- **Red flash** — wrong drum piece or no matching note
- **Gray notes** — missed notes that passed the now line

### Custom Mapping

Different drum pads send different MIDI note numbers. Use the "Learn" mode in settings to remap:

1. Open settings and expand "MIDI Mapping"
2. Click "Learn" next to a lane (e.g., Snare)
3. Hit the pad you want to assign to that lane
4. The MIDI note is saved to that lane

Click "Reset Map" to return to standard GM mapping.

## Band API

`window.feedBackDrums` lets the Build-a-Band stage drive a drum lane. Lanes are identified by their highway canvas.

- `setInputTarget(canvas)` pins kit hits to that lane's canvas (`null` restores the default routing).
- `setDifficulty(id, canvas)` sets the difficulty for that lane only (`easy`, `medium`, `hard`, `expert`, `expert_plus`). Without a canvas it sets the global difficulty. A canvas with no instance yet never changes the global difficulty; the pick is remembered for it. The memory is per canvas, so a lane that re-inits on the same canvas keeps its band difficulty (in split view a panel's own pick still wins). Unknown ids are ignored and not remembered.
- `clearDifficulty(canvas)` forgets the canvas's remembered difficulty; its instance follows the global difficulty again.
- `setMidiInput(logicalSourceKey)` picks the MIDI input like the settings dropdown does, saved as a manual choice. `''` is "None". Non-strings are ignored.
- `getInstanceState(canvas)` returns that lane's scoring state, or `null`.

## Events for other plugins

Every drum view emits its judgments and star power on core's event bus (`window.feedBack.on(...)`):
`drums:hit`, `drums:miss`, `drums:overhit`, `drums:sp-phrase`, `drums:sp-phrase-fail`, `drums:sp-ready`,
`drums:sp-activate` and `drums:sp-end`. Several drum views can be live at once (split view, the band
stage) and all emit on the same bus, so filter by `canvas`: `detail.canvas` is the emitting view's highway
canvas.

Each `detail` holds:

- `type` (`hit`, `miss`, ...) and `time` (player seconds);
- the engine state after the event: `multiplier` (doubled while star power is active), `score` (the
  engine's score, without the plugin's bonuses), `stars`, `combo`, `spActive` and `spAmount` (the star
  power meter, 0..1);
- hits: `pad`, `cymbal`, `id`, `sp`, `bonus`, `offsetMs`, `noteTime` and `points` (what the hit added:
  engine score plus the plugin's timing / roll bonuses);
- misses: `pad`, `cymbal`, `id` and `noteTime`; overhits: `pad` and `cymbal`.

`combo-break` is not emitted: the `combo` on each event shows a broken streak.

## Development

Tests run with plain Node (the org CI runs each `tests/*.test.js`): `node --test tests/*.test.js`, or one
file at a time (`node tests/engine.test.js`, ...). The routes and the WinMM reader have pytest tests:
`python -m pytest tests` (needs fastapi, httpx and PyYAML; no MIDI hardware). `tools/build_sample_kit.py`
and `tools/build_drumgizmo_kit.py` rebuild the sampled kits, `tools/kit_loudness.py` and
`tools/apply_balance.py` level them (need numpy, scipy, soundfile and ffmpeg).

## License

MIT, except the bundled sounds (see [Drum kits](#drum-kits) and NOTICE.md) and `assets/engine.js` / `tests/engine.test.js`: they are ports of
[YARG.Core](https://github.com/YARC-Official/YARG.Core) and stay under the **LGPL-3.0**
(`LICENSE.LGPL-3.0`, with the GPL-3.0 it builds on in `LICENSE.GPL-3.0`). The engine is a separate,
replaceable file that the MIT code only calls through its public API. Details in [NOTICE.md](NOTICE.md).
