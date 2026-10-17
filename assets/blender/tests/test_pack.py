import pack
import pytest


def test_test_assets_never_pack_into_the_shipped_folder(capsys):
    assert pack.main(["--only", "calib"]) == 2
    assert "--out" in capsys.readouterr().err


def test_unknown_asset_is_an_error():
    with pytest.raises(KeyError):
        pack.main(["--only", "nope", "--out", "x"])


def test_pnpm_separator_is_dropped():
    # `pnpm assets:build -- --all` passes a literal leading `--` to the script
    import run

    assert pack._drop_pnpm_separator(["--", "--only", "x"]) == ["--only", "x"]
    assert run._drop_pnpm_separator(["--", "--all"]) == ["--all"]
    assert run._drop_pnpm_separator(["--all"]) == ["--all"]
