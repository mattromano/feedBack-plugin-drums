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
