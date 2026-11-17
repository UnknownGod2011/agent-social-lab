import asyncio
import json

import httpx
import pytest

from providers.base import ProviderError, prompt_for, provider_schema
from providers.gemini import GeminiPool, GeminiProvider, retry_delay
from providers.openai import OpenAIProvider


MODEL = "gemini-3.5-flash-lite"
CONTEXT = {
    "model": MODEL, "agent_id": "A-builder", "role_prompt": "You build validated artifacts.",
    "action_schema": {"type": "object", "properties": {"kind": {"type": "string"}}, "required": ["kind"]},
    "memory": ["An authorized private memory."],
}


def run(coroutine):
    return asyncio.run(coroutine)


def success_response(text='{"kind":"claim_task"}', finish="STOP"):
    return httpx.Response(200, json={
        "candidates": [{"finishReason": finish, "content": {"parts": [{"text": text}]}}],
        "modelVersion": MODEL,
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 40,
                          "thoughtsTokenCount": 10, "cachedContentTokenCount": 20, "totalTokenCount": 150},
    })


def test_native_request_and_reported_usage():
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.path.endswith(f"/{MODEL}:generateContent")
        assert "key=" not in str(request.url)
        body = json.loads(request.content)
        assert body["generationConfig"]["responseFormat"]["text"]["schema"] == CONTEXT["action_schema"]
        assert body["contents"][0]["role"] == "user"
        assert "previous_interaction_id" not in body
        assert "action_schema" not in body["contents"][0]["parts"][0]["text"]
        return success_response()

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            pool = GeminiPool(["test-only-secret"], client=client)
            result = await GeminiProvider(pool, MODEL).generate(CONTEXT)
            assert result["action"] == {"kind": "claim_task"}
            assert result["input_tokens"] == 100 and result["thought_tokens"] == 10
            assert result["total_tokens"] == 150
            assert result["estimated_cost_usd"] == pytest.approx((80 * .3 + 20 * .03 + 50 * 2.5) / 1_000_000)
            assert result["actual_cost_usd"] is None
            assert len(result["prompt_hash"]) == 64
            assert "test-only-secret" not in json.dumps(pool.health())
    run(scenario())
    assert len(calls) == 1


def test_preflight_rotation_disabled_keys_and_secret_free_health():
    seen = []

    def handler(request):
        value = request.headers["x-goog-api-key"]
        seen.append(value)
        if value == "blocked-test-secret":
            return httpx.Response(403, json={"error": {"message": "blocked-test-secret permission problem"}})
        return httpx.Response(200, json={"models": [
            {"name": "models/" + MODEL, "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/embedding-only", "supportedGenerationMethods": ["embedContent"]},
        ]})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            pool = GeminiPool(["healthy-test-a", "blocked-test-secret", "healthy-test-b", "healthy-test-a"], client=client)
            result = await pool.preflight(MODEL)
            assert result["available"] is True and result["models"] == [MODEL]
            assert len(result["credentials"]) == 3
            assert result["credentials"][1]["status"] == "disabled"
            assert [pool.acquire(MODEL).secret for _ in range(3)] == ["healthy-test-a", "healthy-test-b", "healthy-test-a"]
            for secret in seen:
                assert secret not in json.dumps(result)
    run(scenario())


def test_429_honors_retry_info_and_cools_the_whole_unknown_project():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "2"}, json={"error": {"message": "hidden-test-secret",
            "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "9.5s"}]}})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            pool = GeminiPool(["hidden-test-secret", "other-test-secret"], client=client, cooldown_seconds=0)
            provider = GeminiProvider(pool, MODEL)
            with pytest.raises(ProviderError) as first:
                await provider.generate(CONTEXT)
            assert first.value.classification == "rate_limited"
            assert first.value.retry_after == 9.5
            assert first.value.retryable is True
            assert "hidden-test-secret" not in str(first.value)
            with pytest.raises(ProviderError) as second:
                await provider.generate(CONTEXT)
            assert second.value.classification == "pool_cooldown"
            assert all(key["status"] == "cooldown" for key in pool.health())
    run(scenario())
    assert len(calls) == 1


def test_invalid_auth_disables_one_key_and_next_call_rotates():
    seen = []

    def handler(request):
        seen.append(request.headers["x-goog-api-key"])
        if len(seen) == 1:
            return httpx.Response(400, json={"error": {"details": [{"reason": "API_KEY_INVALID"}]}})
        return success_response()

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            pool = GeminiPool(["bad-test-key", "valid-test-key"], client=client)
            provider = GeminiProvider(pool, MODEL)
            with pytest.raises(ProviderError) as error:
                await provider.generate(CONTEXT)
            assert error.value.classification == "authentication_failed"
            assert error.value.retryable is True
            assert (await provider.generate(CONTEXT))["action"]["kind"] == "claim_task"
            assert pool.health()[0]["status"] == "disabled"
    run(scenario())
    assert seen == ["bad-test-key", "valid-test-key"]


@pytest.mark.parametrize("text,finish,classification", [
    ("not json", "STOP", "invalid_json"),
    ('{"kind":"claim_task"}', "MAX_TOKENS", "generation_incomplete"),
    ("[]", "STOP", "invalid_action_shape"),
])
def test_bad_outputs_retain_usage_and_do_not_fabricate_actions(text, finish, classification):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: success_response(text, finish))) as client:
            provider = GeminiProvider(GeminiPool(["test-credential"], client=client), MODEL)
            with pytest.raises(ProviderError) as error:
                await provider.generate(CONTEXT)
            assert error.value.classification == classification
            assert error.value.usage["input_tokens"] == 100
            assert error.value.usage["estimated_cost_usd"] > 0
    run(scenario())


def test_read_timeout_is_uncertain_but_connect_failure_is_not():
    for exception, expected in [(httpx.ReadTimeout, True), (httpx.ConnectError, False)]:
        def handler(request):
            raise exception("Do not expose raw test secret", request=request)

        async def scenario():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                with pytest.raises(ProviderError) as error:
                    await GeminiProvider(GeminiPool(["test-credential"], client=client), MODEL).generate(CONTEXT)
                assert error.value.uncertain is expected
                assert error.value.retryable
                assert "test secret" not in str(error.value)
        run(scenario())


def test_daily_quota_not_retried_immediately():
    async def scenario():
        response = httpx.Response(429, json={"error": {"details": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response)) as client:
            provider = GeminiProvider(GeminiPool(["test-credential"], client=client), MODEL)
            with pytest.raises(ProviderError) as error:
                await provider.generate(CONTEXT)
            assert error.value.classification == "daily_quota_exhausted"
            assert error.value.retry_after > 0
    run(scenario())


def test_transient_status_is_one_attempt_and_bad_request_not_retryable():
    for status, retryable in [(503, True), (400, False), (403, False), (404, False)]:
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(status, json={"error": {"message": "secret not for logs"}})

        async def scenario():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                with pytest.raises(ProviderError) as error:
                    await GeminiProvider(GeminiPool(["test-credential"], client=client), MODEL).generate(CONTEXT)
                assert error.value.retryable is retryable
        run(scenario())
        assert len(requests) == 1


def test_missing_credentials_and_model_change_never_dispatch(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEYS", raising=False)

    async def scenario():
        pool = GeminiPool([])
        try:
            with pytest.raises(ProviderError, match="No server-side"):
                pool.acquire()
            with pytest.raises(ProviderError) as error:
                await GeminiProvider(pool, MODEL).generate({"model": "different-model"})
            assert error.value.classification == "model_config_changed"
        finally:
            await pool.close()
    run(scenario())


def test_openai_confirmation_and_reported_cost_accounting(monkeypatch):
    monkeypatch.setenv("OPENAI_INPUT_USD_PER_MILLION", "1")
    monkeypatch.setenv("OPENAI_OUTPUT_USD_PER_MILLION", "4")
    requests = []

    def handler(request):
        requests.append(request)
        assert request.url.path == "/v1/chat/completions"
        assert json.loads(request.content)["response_format"]["type"] == "json_schema"
        return httpx.Response(200, json={"model": "test-model", "choices": [{"finish_reason": "stop", "message": {"content": '{"kind":"claim_task"}'}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30,
                      "completion_tokens_details": {"reasoning_tokens": 5}}})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = OpenAIProvider("test-model", api_key="test-secret", client=client)
            context = {**CONTEXT, "model": "test-model"}
            with pytest.raises(ProviderError) as error:
                await provider.generate(context)
            assert error.value.classification == "paid_confirmation_required"
            assert requests == []
            result = await provider.generate({**context, "paid_confirmed": True})
            assert result["thought_tokens"] == 5
            assert result["estimated_cost_usd"] == pytest.approx((10 + 20 * 4) / 1_000_000)
            assert result["actual_cost_usd"] is None
    run(scenario())
    assert len(requests) == 1


def test_retry_delay_handles_bad_header():
    assert retry_delay(httpx.Response(503, headers={"Retry-After": "not-a-date"}), 2) == 2


def test_break_prompt_drops_role_prompt_and_all_work_information():
    system, prompt, digest = prompt_for({
        "phase": "break", "department_id": "C", "condition": "small_talk",
        "role_prompt": "Secret project instructions", "tasks": ["work secret"],
        "memory": ["private work memory"], "safe_utterances": {"tea": "I like tea."},
    })
    assert "Secret project" not in system
    assert "work secret" not in prompt and "private work memory" not in prompt
    assert json.loads(prompt)["safe_utterances"]["tea"] == "I like tea."


def test_real_action_schema_is_inlined_and_break_schema_is_non_task_only():
    from engine.domain import action_schema

    work = provider_schema({"action_schema": action_schema()})
    assert "$ref" not in json.dumps(work)
    assert "$defs" not in work and "discriminator" not in work
    assert "anyOf" in work and "oneOf" not in work
    for arm, condition, kind in [("B", "solo_journal", "journal_non_task"), ("C", "small_talk", "chat_smalltalk")]:
        schema = provider_schema({"action_schema": action_schema(), "phase": "break", "department_id": arm, "condition": condition})
        assert schema["properties"]["type"]["enum"] == [kind]
        assert "task_id" not in schema["properties"]


def test_provider_action_menu_enforces_role_permissions():
    from engine.domain import action_schema
    schema = provider_schema({"action_schema": action_schema(), "role": "builder", "phase": "work_block_1"})
    types = {kind for option in schema["anyOf"] for kind in option["properties"]["type"]["enum"]}
    assert "submit_artifact" in types and "claim_task" not in types and "complete_milestone" not in types
