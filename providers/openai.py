"""Optional stateless OpenAI-compatible chat endpoint; no automatic paid calls."""

from __future__ import annotations

import os
import hashlib
import json
import time
from typing import Any

import httpx

from providers.base import ProviderError, count, decode_action, price_estimate, prompt_for, provider_schema
from providers.gemini import retry_delay


class OpenAIProvider:
    credential_name = "OpenAI-compatible"

    def __init__(
        self, model: str, *, api_key: str | None = None, base_url: str | None = None,
        client: httpx.AsyncClient | None = None, max_output_tokens: int = 768,
    ) -> None:
        self.model = model
        self._key = api_key if api_key is not None else os.environ.get("OPENAI_API_KEY", "")
        self._base = (base_url or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0), follow_redirects=False)
        self._owns_client = client is None
        self.max_output_tokens = max_output_tokens

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    def request_body(self, context: dict[str, Any]) -> dict[str, Any]:
        system, user, _ = prompt_for(context)
        return {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_completion_tokens": min(int(context.get("max_output_tokens", self.max_output_tokens)), self.max_output_tokens),
            "response_format": {"type": "json_schema", "json_schema": {"name": "agent_action", "schema": provider_schema(context)}},
        }

    def estimate(self, input_tokens, output_tokens, cached_tokens):
        return price_estimate(self.model, input_tokens, output_tokens, 0, cached_tokens, "OPENAI")

    async def generate(self, context: dict[str, Any]) -> dict[str, Any]:
        if context.get("paid_confirmed") is not True:
            raise ProviderError("paid_confirmation_required", message="Confirm the paid-run estimate before using this adapter.")
        if not self._key:
            raise ProviderError("no_credentials", message=f"No server-side {self.credential_name} key is configured.")
        if context.get("model", self.model) != self.model:
            raise ProviderError("model_config_changed")
        body = self.request_body(context)
        # Includes the actual filtered schema and decoding settings, excluding credentials.
        prompt_hash = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        started = time.perf_counter()
        try:
            response = await self.client.post(self._base + "/chat/completions", headers={"Authorization": "Bearer " + self._key}, json=body)
        except httpx.RequestError as exc:
            uncertain = not isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout))
            raise ProviderError("network_error", True, 1.0, uncertain=uncertain) from None
        if response.status_code != 200:
            raise http_error(response)
        try:
            data = response.json()
            usage = data.get("usage") or {}
            input_tokens, output_tokens = count(usage.get("prompt_tokens")), count(usage.get("completion_tokens"))
            details = usage.get("completion_tokens_details") or {}
            cached_tokens = count((usage.get("prompt_tokens_details") or {}).get("cached_tokens"))
            if cached_tokens is None:
                cached_tokens = count(usage.get("prompt_cache_hit_tokens"))
            total_tokens = count(usage.get("total_tokens"))
            if total_tokens is None and input_tokens is not None and output_tokens is not None:
                total_tokens = input_tokens + output_tokens
            result = {
                "input_tokens": input_tokens, "output_tokens": output_tokens,
                "thought_tokens": count(details.get("reasoning_tokens")), "cached_tokens": cached_tokens,
                "total_tokens": total_tokens, "actual_cost_usd": None,
                # Compatible completion_tokens already includes reasoning; do not double-count it.
                "estimated_cost_usd": self.estimate(input_tokens, output_tokens, cached_tokens),
                "elapsed_ms": round((time.perf_counter() - started) * 1000), "model": data.get("model", self.model),
                "prompt_hash": prompt_hash, "system_fingerprint": data.get("system_fingerprint"),
            }
            choices = data.get("choices") or []
            if not choices or choices[0].get("finish_reason") not in {None, "stop"}:
                raise ProviderError("generation_incomplete", True, usage=result)
            try:
                result["action"] = decode_action(choices[0]["message"]["content"])
            except ProviderError as exc:
                exc.usage = result
                raise
            return result
        except (ValueError, KeyError, TypeError, AttributeError, IndexError):
            raise ProviderError("invalid_provider_response", True, uncertain=True) from None


def http_error(response: httpx.Response) -> ProviderError:
    status = response.status_code
    category = {
        400: "invalid_request", 401: "authentication_failed", 402: "billing_unavailable",
        403: "permission_denied", 404: "model_unavailable", 422: "invalid_request", 429: "rate_limited",
        408: "provider_timeout", 500: "provider_unavailable", 502: "provider_unavailable",
        503: "provider_unavailable", 504: "provider_timeout",
    }.get(status, "provider_request_failed")
    transient = status in {408, 429, 500, 502, 503, 504}
    return ProviderError(category, transient, retry_delay(response) if transient else None, uncertain=status == 408 or status >= 500)
