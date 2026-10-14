"""routes.py: the MIDI monitor log route (no MIDI hardware, no core needed)."""

import importlib.util
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_spec = importlib.util.spec_from_file_location("drums_routes", Path(__file__).resolve().parent.parent / "routes.py")
routes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(routes)


def _client(tmp_path, host="127.0.0.1", **ctx):
    app = FastAPI()
    routes.setup(app, {"config_dir": tmp_path, **ctx})
    return TestClient(app, client=(host, 50000))


def test_midi_log_appends_one_line_per_recording(tmp_path):
    c = _client(tmp_path)
    rec = {"saved": "2026-10-13T00:00:00Z", "summary": {"notes": {}}, "log": [[0, 153, 38, 100], [12.5, 185, 4, 127]]}
    r = c.post("/api/plugins/drums/midi-log", content=json.dumps(rec))
    assert r.status_code == 200 and r.json()["ok"]
    c.post("/api/plugins/drums/midi-log", content=json.dumps({"log": []}))
    lines = (tmp_path / "drums" / "midi_log.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["log"][1] == [12.5, 185, 4, 127]


@pytest.mark.parametrize("body", [b"not json", b"[1, 2]", b'{"log": "x"}', b"\xff\xfe"])
def test_midi_log_rejects_bad_bodies(tmp_path, body):
    r = _client(tmp_path).post("/api/plugins/drums/midi-log", content=body)
    assert r.status_code == 400
    assert not (tmp_path / "drums" / "midi_log.jsonl").exists()


def test_midi_log_is_local_only_and_size_capped(tmp_path):
    r = _client(tmp_path, host="192.168.4.20").post("/api/plugins/drums/midi-log", content=b'{"log": []}')
    assert r.status_code == 403
    with pytest.raises(ValueError):
        routes.append_midi_log(tmp_path, b" " * (routes.MIDI_LOG_MAX + 1))


def test_native_midi_is_a_harmless_no_op_off_windows(tmp_path, monkeypatch):
    monkeypatch.delenv("DRUMS_MIDI_TEST", raising=False)
    c = _client(tmp_path)
    r = c.get("/api/plugins/drums/native-midi")
    assert r.status_code == 200
    if not routes._load_native_midi({}).available():   # macOS / Linux
        assert r.json() == {"available": False, "inputs": []}
        with c.websocket_connect("/ws/plugins/drums/midi?id=0") as ws:
            assert "error" in json.loads(ws.receive_text())
    assert _client(tmp_path, host="10.0.0.2").get("/api/plugins/drums/native-midi").status_code == 403


def test_native_midi_socket_streams_messages_with_times(tmp_path, monkeypatch):
    monkeypatch.setenv("DRUMS_MIDI_TEST", "1")
    c = _client(tmp_path)
    lst = c.get("/api/plugins/drums/native-midi").json()
    assert lst["available"] and {"id": 999, "name": "Drums test kit"} in lst["inputs"]
    with c.websocket_connect("/ws/plugins/drums/midi?id=999") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["open"] and hello["id"] == 999
        ws.send_text(json.dumps({"ping": 12.5}))
        pong = json.loads(ws.receive_text())
        assert pong["pong"] == 12.5 and pong["t"] > 0
        sent = c.post("/api/plugins/drums/native-midi/inject", json={"id": 999, "data": [0x99, 38, 100]}).json()
        msg = json.loads(ws.receive_text())
        assert msg["d"] == [0x99, 38, 100]
        assert abs(msg["t"] - sent["t"]) < 1000


def test_setup_uses_load_sibling_when_core_provides_it(tmp_path):
    loaded = []

    def load_sibling(name):
        loaded.append(name)
        return routes._load_native_midi({})

    _client(tmp_path, load_sibling=load_sibling)
    assert loaded == ["native_midi"]


CH_PROFILE = """DeviceName: CH 2
Mappings:
  Red Pad:
  - NoteNumber: 38
    Velocity: 10
    OverHitThreshold: 0
  Yellow Pad:
  - NoteNumber: 48
    Velocity: 10
  Blue Pad:
  - NoteNumber: 45
  Green Pad:
  - NoteNumber: 43
  Kick Pad:
  - NoteNumber: 36
  Yellow Cymbal:
  - NoteNumber: 42
  - NoteNumber: 46
  - NoteNumber: 24
  Blue Cymbal:
  - NoteNumber: 49
  Green Cymbal:
  - NoteNumber: 51
  Start: []
  Select: []
"""


def test_parse_clone_hero_profile_maps_by_colour():
    device, mapping, min_vel = routes.parse_ch_midi_profile(CH_PROFILE)
    assert device == "CH 2"
    assert mapping == {38: "snare", 48: "tom1", 45: "tom2", 43: "tom3", 36: "kick",
                       42: "hihat", 46: "hihat", 24: "hihat", 49: "ride", 51: "crash"}
    assert min_vel == {38: 10, 48: 10}


def _ch_dir(tmp_path):
    ch = tmp_path / "Clone Hero"
    (ch / "MIDI Profiles").mkdir(parents=True)
    (ch / "MIDI Profiles" / "CH 2.yaml").write_text(CH_PROFILE, encoding="utf-8")
    (ch / "MIDI Profiles" / "Other Kit.yaml").write_text(
        "DeviceName: Other Kit\nMappings:\n  Red Pad:\n  - NoteNumber: 40\n", encoding="utf-8")
    (ch / "profiles.ini").write_text("[profile0]\nmidi_device_name = CH 2\n", encoding="utf-8")
    return ch


def test_find_kit_mapping_uses_the_active_profile(tmp_path, monkeypatch):
    monkeypatch.setenv("CLONE_HERO_DIR", str(_ch_dir(tmp_path)))
    monkeypatch.setattr(routes.Path, "home", staticmethod(lambda: tmp_path / "nohome"))
    r = routes.find_kit_mapping()
    assert r["device"] == "CH 2"
    assert r["mapping"]["49"] == "ride" and r["mapping"]["51"] == "crash"
    assert r["source"].endswith("CH 2.yaml")


def test_find_kit_mapping_without_clone_hero(tmp_path, monkeypatch):
    monkeypatch.delenv("CLONE_HERO_DIR", raising=False)
    monkeypatch.setattr(routes.Path, "home", staticmethod(lambda: tmp_path))
    assert routes.find_kit_mapping()["mapping"] is None


def test_kit_mapping_route_keeps_file_paths_on_this_computer(tmp_path, monkeypatch):
    monkeypatch.setenv("CLONE_HERO_DIR", str(_ch_dir(tmp_path)))
    monkeypatch.setattr(routes.Path, "home", staticmethod(lambda: tmp_path / "nohome"))
    local = _client(tmp_path).get("/api/plugins/drums/kit-mapping").json()
    assert local["device"] == "CH 2" and "source" in local
    guest = _client(tmp_path, host="192.168.4.20").get("/api/plugins/drums/kit-mapping").json()
    assert guest["mapping"] == local["mapping"] and "source" not in guest
