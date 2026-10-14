# Licensing notice for the drums plugin

Most of this plugin is original code under the **MIT** license (see `README.md`). That includes
`screen.js`, `assets/session.js`, `assets/highway3d.js` (the 3D view), `assets/kits.js`, `tools/`, `plugin.json`, the other assets and the tests other than
`tests/engine.test.js`. The bundled drum sounds have their own licences (below).

Two files are ports of [YARG.Core](https://github.com/YARC-Official/YARG.Core) and are licensed under the
**GNU Lesser General Public License v3.0** (full text in [`LICENSE.LGPL-3.0`](LICENSE.LGPL-3.0); the LGPL
builds on the GNU GPL v3.0, whose text is in [`LICENSE.GPL-3.0`](LICENSE.GPL-3.0)):

| File | Status |
|------|--------|
| `assets/engine.js` | LGPL-3.0. JavaScript port, with modifications, of YARG.Core's drums engine (`Engine/Drums/DrumsEngine.cs`, `Engine/Drums/Engines/YargDrumsEngine.cs`, `DrumsEngineParameters.cs`, `DrumsStats.cs`, `Engine/BaseEngine*.cs`, `BaseStats.cs`, `HitWindowSettings.cs`, `Chart/Notes/DrumNote.cs`, `Note.cs`, drum activation flags from `InstrumentDifficultyExtensions.cs`, and defaults from `Game/Presets/EnginePreset*.cs`). It also takes the drum star thresholds from YARG's `DrumsPlayer.cs` (LGPL-3.0). Copyright (c) YARC (YARG) contributors. |
| `tests/engine.test.js` | LGPL-3.0. Tests for `engine.js`, partly ported from `YARG.Core.UnitTests/Engine/DrumEngineTester.cs` and `DrumsStatsTests.cs`. |

`assets/engine.js` is a standalone, unminified script with no dependencies, shipped as its own file and
loaded at runtime. `screen.js`, `assets/session.js` and `assets/highway3d.js` only use it through its public API
(`window.DrumsEngine` / `require('./engine.js')`), so they remain separate MIT works that use the Library
as described in LGPL-3.0 section 4 ("Combined Works"). You may replace `assets/engine.js` with a modified
version. If you distribute changes to `assets/engine.js`, they must stay under LGPL-3.0 and their source
must stay available. Combining an LGPL-3.0 file with MIT code this way is permitted by both licenses, and
both are compatible with feedBack's AGPL-3.0.

The header of `assets/engine.js` lists every behaviour that deviates from YARG ("Deviations from YARG").
The scoring look and feel imitates rhythm-game drum tracks but uses no artwork, fonts or logos from them.

## Bundled drum sounds (`assets/sounds/`)

| Files | License |
|-------|---------|
| `assets/sounds/WebAudioFontPlayer.js` | **GPL-3.0** (text in [`LICENSE.GPL-3.0`](LICENSE.GPL-3.0)). WebAudioFont player, unmodified, by Sergey Surikov (https://github.com/surikov/webaudiofont). A separate script the synth loads at runtime, only for the General MIDI kits; the rest of the plugin only calls its public `WebAudioFontPlayer` API. Its source is the file itself. |
| `assets/sounds/128*_0_JCLive_sf2_file.js`, `128*_0_FluidR3_GM_sf2_file.js`, `128*_0_SBLive_sf2.js`, `128*_0_Chaos_sf2_file.js` | **MIT**. General MIDI drum samples (JCLive, FluidR3 GM, SB Live! and Chaos sets) from https://github.com/surikov/webaudiofontdata, unmodified. |
| `assets/sounds/kits/crocell/*` | **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). Derived from **CrocellKit 1.1** for DrumGizmo, stereo mix (`CrocellKit_Stereo_MIX.rar`, https://drumgizmo.org/wiki/doku.php?id=kits:crocellkit). Kit of the Danish band Crocell; kit setup by Andreas (Crocell, crocell.dk), mic setup by Jacob Olsen (JBOSound, jbosound.com), sampled, edited and prepared by Lars Muldjord / the DrumGizmo team (drumgizmo.org). **Changes:** a subset of hits (4 velocity layers x 2 per piece) picked, trimmed, faded, level-balanced and re-encoded to Ogg Vorbis by `tools/build_sample_kit.py`; some pieces are reused for other GM notes. |
| `assets/sounds/kits/virtuosity/*` | **CC0 1.0** (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/). Derived from **Virtuosity Drums** by Versilian Studios and Karoryfer Samples, played by Austin McMahon (https://github.com/sfzinstruments/virtuosity_drums). Mixed from its overhead, kick and snare mics like the library's "basic kit", trimmed and re-encoded by `tools/build_sample_kit.py`; the mid tom is the high tom tuned down 4 semitones. Credit given as a courtesy. |

When you use the plugin's drum sounds in a recording, CC BY 4.0 asks that the CrocellKit credit above goes
with it.
