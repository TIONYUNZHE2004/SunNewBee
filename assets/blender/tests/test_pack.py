import pack
import pytest


def test_test_assets_never_pack_into_the_shipped_folder(capsys):
    assert pack.main(["--only", "calib"]) == 2
    assert "--out" in capsys.readouterr().err


def test_unknown_asset_is_an_error():
    with pytest.raises(KeyError):
        pack.main(["--only", "nope", "--out", "x"])
