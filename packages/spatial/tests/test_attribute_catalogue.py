from townshiplens_spatial.attributes import ATTRIBUTE_TYPES, validate_value


def test_sidewalk_is_a_catalogued_enum():
    kind, allowed = ATTRIBUTE_TYPES["sidewalk"]
    assert kind == "enum" and allowed == {"both", "one_side", "none", "separate"}
    for v in ("both", "one_side", "none", "separate"):
        assert validate_value("sidewalk", v) is None
    for bad in ("yes", "left", True, None, 2):
        assert validate_value("sidewalk", bad) is not None
