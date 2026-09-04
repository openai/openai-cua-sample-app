from app import config


def test_root_env_load_happens_with_shell_precedence(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text('OPENAI_API_KEY="file-key"\nCUA_DEFAULT_MODEL="file-model"\nPORT="4141"\n')
    app_root = tmp_path / "python-app"
    app_root.mkdir()
    (app_root / ".env").write_text('PORT="4242"\n')
    monkeypatch.setattr(config, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(config, "APP_ROOT", app_root)
    monkeypatch.setenv("OPENAI_API_KEY", "shell-key")
    monkeypatch.setenv("CUA_DEFAULT_MODEL", "shell-model")
    monkeypatch.delenv("PORT", raising=False)
    config.load_environment()
    import os
    assert os.environ["OPENAI_API_KEY"] == "shell-key"
    assert config.Settings.from_environment().default_model == "shell-model"
    assert config.Settings.from_environment().port == 4141


def test_app_env_is_not_a_fallback(tmp_path, monkeypatch):
    app_root = tmp_path / "python-app"
    app_root.mkdir()
    (app_root / ".env").write_text('OPENAI_API_KEY="app-key"\nPORT="4242"\n')
    monkeypatch.setattr(config, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(config, "APP_ROOT", app_root)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("PORT", raising=False)
    config.load_environment()
    import os
    assert "OPENAI_API_KEY" not in os.environ
    assert config.Settings.from_environment().port == 4041
