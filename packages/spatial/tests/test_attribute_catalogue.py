from townshiplens_spatial.attributes import ATTRIBUTE_TYPES, validate_value


def test_sidewalk_is_a_catalogued_enum():
    kind, allowed = ATTRIBUTE_TYPES["sidewalk"]
    assert kind == "enum" and allowed == {"both", "one_side", "none", "separate"}
    for v in ("both", "one_side", "none", "separate"):
        assert validate_value("sidewalk", v) is None
    for bad in ("yes", "left", True, None, 2):
        assert validate_value("sidewalk", bad) is not None


def test_attribute_labels_cover_the_catalogue_and_match_the_web_catalogue():
    import re
    from pathlib import Path

    from townshiplens_spatial.attributes import ATTRIBUTE_LABELS

    assert set(ATTRIBUTE_LABELS) == set(ATTRIBUTE_TYPES)
    assert ATTRIBUTE_LABELS["incline_pct"] == "Incline (%)"
    assert ATTRIBUTE_LABELS["width_m"] == "Width (m)"
    assert ATTRIBUTE_LABELS["step_count"] == "Steps"
    assert ATTRIBUTE_LABELS["sidewalk"] == "Sidewalk"
    # Drift: the web catalogue lists the same keys (attributeCatalogue.ts).
    ts = (
        Path(__file__).resolve().parents[3] / "apps/web/src/features/manage/attributeCatalogue.ts"
    ).read_text(encoding="utf-8")
    web = set()
    for name in ("NUMBER_KEYS", "BOOLEAN_KEYS", "TEXT_KEYS"):
        body = re.search(rf"const {name} = \[(.*?)\];", ts, re.S).group(1)
        web |= set(re.findall(r'"(\w+)"', body))
    enums = re.search(r"const ENUMS[^=]*=\s*\{(.*?)\n\};", ts, re.S).group(1)
    web |= set(re.findall(r"^  (\w+):", enums, re.M))
    assert web == set(ATTRIBUTE_LABELS)
    assert all(v and "_" not in v for v in ATTRIBUTE_LABELS.values())
