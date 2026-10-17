"""Per-footprint heights from a DSM: synthetic DSMs only, no network, no key."""

import json

import numpy as np
import pytest

from data.scripts import gtiles
from data.scripts import sample_heights as sh

EXTENT = (-50.0, -50.0, 50.0, 50.0)  # xmin, ymin, xmax, ymax (ENU metres), 1 m cells
BOX = np.array([[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], dtype=np.float64)


def _centres():
    xs = np.arange(-49.5, 50, 1.0)
    return np.meshgrid(xs, xs)  # X, Y with row index = y


def _dsm(ground=10.0, roof=19.0):
    x, y = _centres()
    dsm = np.full(x.shape, ground)
    dsm[(np.abs(x) < 5) & (np.abs(y) < 5)] = roof
    return dsm


NO_OTHERS = np.zeros((100, 100), dtype=bool)


def test_build_dsm_keeps_max_per_cell_and_nan_where_empty():
    pts = np.array([[0.2, 0.3, 5.0], [0.7, 0.1, 9.0], [-49.9, -49.9, 1.0], [80, 0, 99.0]])
    dsm = sh.build_dsm(pts, EXTENT)
    assert dsm.shape == (100, 100)
    assert dsm[50, 50] == 9.0  # row = y, column = x
    assert dsm[0, 0] == 1.0
    assert np.isnan(dsm[10, 10])
    assert np.nanmax(dsm) == 9.0  # the point outside the extent is dropped


def test_box_on_flat_ground():
    s = sh.footprint_sample(BOX, _dsm(), EXTENT, NO_OTHERS)
    assert s is not None
    assert s["height_m"] == pytest.approx(9.0, abs=0.5)
    assert s["coverage"] >= 0.9
    assert s["roof_p90"] == pytest.approx(19.0, abs=0.5)
    assert s["ground_p10"] == pytest.approx(10.0, abs=0.5)


def test_tree_canopy_in_ground_ring_is_ignored():
    dsm = _dsm()
    x, y = _centres()
    dsm[(x > 7) & (x < 14) & (np.abs(y) < 4)] = 22.0  # 12 m canopy beside the box
    s = sh.footprint_sample(BOX, dsm, EXTENT, NO_OTHERS)
    assert s is not None and s["height_m"] == pytest.approx(9.0, abs=0.5)


def test_sparse_footprint_is_rejected():
    dsm = _dsm()
    x, y = _centres()
    inside = (np.abs(x) < 5) & (np.abs(y) < 5)
    rng = np.random.default_rng(0)
    dsm[inside & (rng.random(dsm.shape) > 0.3)] = np.nan  # about 30 % of cells filled
    assert sh.footprint_sample(BOX, dsm, EXTENT, NO_OTHERS) is None


@pytest.mark.parametrize("roof", [11.0, 260.0])
def test_implausible_heights_are_rejected(roof):
    assert sh.footprint_sample(BOX, _dsm(roof=roof), EXTENT, NO_OTHERS) is None


def test_neighbouring_footprint_in_ring_is_excluded():
    dsm = _dsm()
    x, y = _centres()
    outside = ~((np.abs(x) < 6) & (np.abs(y) < 6))
    neighbour = outside & (y > -17)  # covers almost all of the 3-15 m ring
    dsm[neighbour] = 25.0
    unmasked = sh.footprint_sample(BOX, dsm, EXTENT, NO_OTHERS)
    assert unmasked is None or abs(unmasked["height_m"] - 9.0) > 0.5
    s = sh.footprint_sample(BOX, dsm, EXTENT, neighbour)
    assert s is not None and s["height_m"] == pytest.approx(9.0, abs=0.5)


def test_rasterise_marks_cell_centres_inside():
    mask = sh.rasterise(BOX, EXTENT, (100, 100))
    assert mask.sum() == 100
    assert mask[50, 50] and not mask[50, 56]


# --- pipeline helpers ------------------------------------------------------------


def test_bbox_arg():
    assert sh.parse_bbox("hero", []) == sh.HERO_BBOX
    assert sh.parse_bbox("101.5,3.17,101.52,3.19", []) == (101.5, 3.17, 101.52, 3.19)
    rings = [[[101.49, 3.16], [101.53, 3.2], [101.5, 3.18]], [[101.51, 3.15], [101.52, 3.17]]]
    assert sh.parse_bbox("township", rings) == (101.49, 3.15, 101.53, 3.2)
    with pytest.raises(SystemExit):
        sh.parse_bbox("1,2,3", [])


def test_frame_check_accepts_plausible_points_and_flags_frame_bugs():
    rng = np.random.default_rng(1)
    xy = rng.uniform(-40, 40, (500, 2))
    good = np.column_stack([xy, 30 + rng.random(500)])
    assert sh.frame_check(good, EXTENT) is None
    assert "height" in sh.frame_check(good + [0, 0, 6.37e6], EXTENT)
    assert "outside" in sh.frame_check(good + [50_000, 0, 0], EXTENT)
    assert "no points" in sh.frame_check(np.zeros((0, 3)), EXTENT)


def test_tile_points_to_enu_round_trip():
    lon0, lat0 = 101.51, 3.18
    world = np.eye(4)
    world[:3, 3] = gtiles.ecef(lon0, lat0)  # tile frame: ECEF axes, origin at (lon0, lat0)
    north_up = gtiles.ecef(lon0, lat0 + 0.0001, 20.0) - gtiles.ecef(lon0, lat0)
    enu = sh.to_enu(np.array([north_up]), world, gtiles.enu_matrix(lon0, lat0))
    assert enu[0] == pytest.approx([0.0, 11.06, 20.0], abs=0.05)


def test_merge_keeps_earlier_samples():
    old = {"as_of": "2026-01-01", "source": sh.SOURCE, "samples": {"w1": {"height_m": 5.0}}}
    new = sh.merge(old, {"w2": {"height_m": 7.0}}, "2026-10-17")
    assert new == {
        "as_of": "2026-10-17",
        "source": sh.SOURCE,
        "samples": {"w1": {"height_m": 5.0}, "w2": {"height_m": 7.0}},
    }
    assert sh.merge(None, {"w2": {"height_m": 7.0}}, "2026-10-17")["samples"] == {
        "w2": {"height_m": 7.0}
    }


def test_main_reports_blocked_on_403_without_leaking_key(tmp_path, monkeypatch, capsys):
    class Forbidden:
        status_code = 403
        content = b"API key not authorized for this referrer"

    monkeypatch.setattr(sh, "load_key", lambda: "SECRET-KEY")
    monkeypatch.setattr(
        sh,
        "make_fetcher",
        lambda key, n: gtiles.Fetcher(key, n, cache=tmp_path, get=lambda *a, **k: Forbidden()),
    )
    with pytest.raises(SystemExit) as exc:
        sh.main(["--bbox", "hero", "--plan", "--max-requests", "5"])
    assert exc.value.code == 2
    out = capsys.readouterr().out
    assert out.startswith("BLOCKED:") and "403" in out and "referrer" in out
    assert "SECRET-KEY" not in out


def test_main_without_key_is_blocked(monkeypatch, capsys):
    monkeypatch.setattr(sh, "load_key", lambda: "")
    with pytest.raises(SystemExit) as exc:
        sh.main(["--bbox", "hero", "--plan"])
    assert exc.value.code == 2
    assert "GOOGLE_MAPS_API_KEY" in capsys.readouterr().out


def test_main_plan_counts_json_and_glb(tmp_path, monkeypatch, capsys):
    host = "https://tile.googleapis.com"
    files = "/v1/3dtiles/datasets/D/files/"
    c = gtiles.ecef(101.51, 3.18)
    box = [*c, 500, 0, 0, 0, 500, 0, 0, 0, 500]
    root = {
        "root": {
            "boundingVolume": {"box": box},
            "geometricError": 100,
            "children": [
                {"boundingVolume": {"box": box}, "geometricError": 1, "content": {"uri": u}}
                for u in (f"{files}a.glb?session=S", f"{files}b.glb?session=S")
            ],
        }
    }
    routes = {host + "/v1/3dtiles/root.json": json.dumps(root).encode()}

    class Ok:
        status_code = 200

        def __init__(self, body):
            self.content = body

    def get(url, timeout=None):
        assert ".glb" not in url
        return Ok(routes[url.split("?")[0]])

    monkeypatch.setattr(sh, "load_key", lambda: "K")
    monkeypatch.setattr(
        sh, "make_fetcher", lambda key, n: gtiles.Fetcher(key, n, cache=tmp_path, get=get)
    )
    sh.main(["--bbox", "hero", "--plan", "--max-requests", "5"])
    out = capsys.readouterr().out
    assert "JSON requests made: 1" in out
    assert "glb tiles needed: 2" in out
    assert "complete: yes" in out


# --- sampling run guards (fake traversal, no network) -------------------------------


class _NoFetch:
    requests_made = 0
    max_requests = 10


def _sampling_env(tmp_path, monkeypatch, glbs, positions):
    """main() in sampling mode over a fake traversal of `glbs` tiles; positions(glb) stands in
    for gtiles.glb_positions. Returns the list of tiles the run consumed."""
    out = tmp_path / "height_samples.json"
    monkeypatch.setattr(sh, "OUT", out)
    monkeypatch.setattr(sh, "load_key", lambda: "K")
    monkeypatch.setattr(sh, "make_fetcher", lambda key, n: _NoFetch())
    monkeypatch.setattr(sh, "_footprints", lambda bbox: [])
    consumed = []

    def fake_traverse(bbox, fetch, max_error, plan_only=False, count_leaves=False):
        for i in range(glbs):
            consumed.append(i)
            yield np.eye(4), f"https://h/{i}.glb", b"glb"

    monkeypatch.setattr(sh.gtiles, "traverse", fake_traverse)
    monkeypatch.setattr(sh.gtiles, "glb_positions", positions)
    return out, consumed


def _unsupported(_glb):
    raise gtiles.UnsupportedGlb("glb requires unsupported extension(s): EXT_meshopt_compression")


def test_sampling_aborts_early_when_first_glbs_are_unsupported(tmp_path, monkeypatch, capsys):
    out, consumed = _sampling_env(tmp_path, monkeypatch, 50, _unsupported)
    with pytest.raises(SystemExit) as exc:
        sh.main(["--bbox", "hero"])
    assert exc.value.code == 4
    assert len(consumed) == sh.FIRST_TILES_CHECK
    assert "FRAME CHECK NOT RUN" in capsys.readouterr().out
    assert not out.exists()


def test_sampling_aborts_early_when_first_glbs_have_no_points(tmp_path, monkeypatch, capsys):
    out, consumed = _sampling_env(tmp_path, monkeypatch, 50, lambda _g: np.zeros((0, 3)))
    with pytest.raises(SystemExit) as exc:
        sh.main(["--bbox", "hero"])
    assert exc.value.code == 4 and len(consumed) == sh.FIRST_TILES_CHECK
    assert not out.exists()


def test_sampling_without_frame_check_writes_nothing(tmp_path, monkeypatch, capsys):
    out, consumed = _sampling_env(tmp_path, monkeypatch, 1, lambda _g: np.zeros((0, 3)))
    with pytest.raises(SystemExit) as exc:
        sh.main(["--bbox", "hero"])
    assert exc.value.code == 4 and consumed == [0]
    assert "FRAME CHECK NOT RUN" in capsys.readouterr().out
    assert not out.exists()


def test_sampling_reads_inputs_before_traversal(tmp_path, monkeypatch):
    out, consumed = _sampling_env(tmp_path, monkeypatch, 5, _unsupported)
    out.write_text("{not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        sh.main(["--bbox", "hero"])
    assert consumed == []


def test_plan_count_leaves_estimates_a_full_run(tmp_path, monkeypatch, capsys):
    host = "https://tile.googleapis.com"
    files = "/v1/3dtiles/datasets/D/files/"
    c = gtiles.ecef(101.51, 3.181)
    box = [*c, 50, 0, 0, 0, 50, 0, 0, 0, 50]
    root = {
        "root": {
            "boundingVolume": {"box": box},
            "geometricError": 100,
            "children": [
                {"boundingVolume": {"box": box}, "geometricError": 2, "content": {"uri": u}}
                for u in (
                    f"{files}leaf1.json?session=S",
                    f"{files}leaf2.json?session=S",
                    f"{files}direct.glb?session=S",
                )
            ],
        }
    }
    routes = {host + "/v1/3dtiles/root.json": json.dumps(root).encode()}

    class Ok:
        status_code = 200

        def __init__(self, body):
            self.content = body

    def get(url, timeout=None):
        assert "root.json" in url, f"only root.json may be fetched, got {url}"
        return Ok(routes[url.split("?")[0]])

    monkeypatch.setattr(sh, "load_key", lambda: "K")
    monkeypatch.setattr(
        sh, "make_fetcher", lambda key, n: gtiles.Fetcher(key, n, cache=tmp_path, get=get)
    )
    sh.main(["--bbox", "hero", "--plan", "--count-leaves", "--max-requests", "5"])
    out = capsys.readouterr().out
    assert "JSON requests made: 1" in out
    assert "leaf tilesets counted (not fetched): 2" in out
    assert "direct glb tiles: 1" in out
    # fresh root 1 + leaf JSON 2 + leaf glb 2 (one per leaf) + direct glb 1
    assert "estimated requests for a full run: 6" in out
    assert "complete: yes" in out


def test_count_leaves_needs_plan(monkeypatch):
    monkeypatch.setattr(sh, "load_key", lambda: "K")
    with pytest.raises(SystemExit) as exc:
        sh.main(["--bbox", "hero", "--count-leaves"])
    assert exc.value.code == 2
