from townshiplens_agent.settings import AgentSettings


def test_settings_default_mock(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    s = AgentSettings(_env_file=None)
    assert s.provider == "mock" and s.llm_model_default == "anthropic/claude-haiku-5.5"


def test_settings_openrouter_when_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert AgentSettings(_env_file=None).provider == "openrouter"


def test_empty_llm_provider_means_default(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("OPENROUTER_API_KEY=\nLLM_PROVIDER=\n")
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert AgentSettings(_env_file=env).provider == "mock"
    assert AgentSettings(_env_file=None, llm_provider="", openrouter_api_key="k").provider == (
        "openrouter"
    )
