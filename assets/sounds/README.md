# Bundled drum sounds

Served by core's plugin assets route at `/api/plugins/drums/assets/sounds/<file>`, so the drum synth works
offline and loads nothing from third-party sites. Licences and credits: [`../../NOTICE.md`](../../NOTICE.md).

- `WebAudioFontPlayer.js` — WebAudioFont player by Sergey Surikov, **GPL-3.0**
  (https://github.com/surikov/webaudiofont, `npm/dist/WebAudioFontPlayer.js`), unmodified. Loaded only when
  a General MIDI kit is picked.
- `128<note>_0_<set>.js` — General MIDI drum samples from webaudiofontdata by Sergey Surikov, **MIT**
  (https://github.com/surikov/webaudiofontdata, `sound/`), unmodified: one file per GM drum note the plugin
  plays (35–59, `screen.js` `DRUM_MIDI_NOTES`) for each GM kit in `screen.js` `DRUM_KITS`: `JCLive_sf2_file`,
  `FluidR3_GM_sf2_file`, `SBLive_sf2`, `Chaos_sf2_file`. Each defines one `_drum_<note>_0_<set>` preset.
- `kits/<kit>/` — real multi-sampled acoustic kits with velocity layers (`DRUM_KITS` entries with
  `type: 'samples'`, played by `assets/kits.js`):
  - `crocell/` — CrocellKit 1.1 (DrumGizmo) stereo mix, **CC BY 4.0**, rock kit (the default kit). 4.7 MB.
  - `virtuosity/` — Virtuosity Drums (Versilian Studios / Karoryfer), **CC0**, jazz kit. 3.6 MB.

  Each holds `kit.json` + `<piece>_v<layer>_<a|b>.ogg` (Ogg Vorbis q5, 48 kHz stereo); the format is
  described at the top of `assets/kits.js`. Rebuild from the source libraries with
  `python -I tools/build_sample_kit.py <crocell|virtuosity> <source folder>` (downloads:
  https://drumgizmo.org/kits/CrocellKit/CrocellKit_Stereo_MIX.rar, extract it; and
  https://github.com/sfzinstruments/virtuosity_drums). The script documents how hits are picked and trimmed.

To add a WebAudioFont kit: download its 22 note files, add the set to `DRUM_KITS` and check
`tests/kits.test.js`. To add a sampled kit: add it to `tools/build_sample_kit.py` `KITS`, build it into
`kits/<id>/`, add a `DRUM_KITS` entry `{ type: 'samples', dir: '<id>' }` and its licence to `NOTICE.md`.
The whole sound set is about 12 MB.
