import asyncio
from types import SimpleNamespace
import pytest
from runtime.jev import judge, questions_for


class FakeClient:
    def __init__(self, **kwargs):
        assert kwargs["timeout"] == 45.0
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass
    async def system_one(self, *, state, questions):
        assert "claim_0" in questions
        assert state["claims"][0]["id"] == "c1"
        return SimpleNamespace(model="jev-test", choices={"claim_0": SimpleNamespace(choice="supports", confidence=.91, probabilities={"supports":.91,"contradicts":.03,"insufficient":.06})}, model_dump=lambda **_: {"model":"jev-test","answers":{}})


def test_typed_response_provenance(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-placeholder")
    result = asyncio.run(judge({"task":"assess","claims":[{"id":"c1","text":"The measured claim"}]}, FakeClient))
    assert result["decisions"][0]["choice"] == "supports"
    assert result["model"] == "jev-test"
    assert len(result["stateHash"]) == 64
    assert "test-placeholder" not in str(result)


def test_missing_key_and_invalid_task(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="not configured"):
        asyncio.run(judge({"task":"assess","claims":[{"id":"c1","text":"Claim"}]}, FakeClient))
    with pytest.raises(ValueError):
        questions_for("authorize", [{"id":"c1","text":"Claim"}])
