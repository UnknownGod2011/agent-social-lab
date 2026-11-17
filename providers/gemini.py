"""Gemini REST adapter: one attempt per call, secret-free credential health."""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from providers.base import ProviderError, count, decode_action, price_estimate, prompt_for, provider_schema

API_BASE = "https://generativelanguage.googleapis.com/v1beta"


@dataclass
class Credential:
    secret: str = field(repr=False)
    key_id: str
    disabled: bool = False
    last_error: str | None = None
    requests: int = 0
    successes: int = 0
    models: set[str] | None = None


def retry_delay(response: httpx.Response, default: float = 1.0) -> float:
    """Honor both HTTP Retry-After forms and Google's RetryInfo duration."""
    delays = [default]
    raw = response.headers.get("retry-after")
    if raw:
        try:
            delays.append(float(raw))
        except ValueError:
            try:
                delays.append((parsedate_to_datetime(raw) - datetime.now(timezone.utc)).total_seconds())
            except (ValueError, TypeError):
                pass
    try:
        details = response.json().get("error", {}).get("details", [])
        for detail in details:
            if detail.get("@type", "").endswith("google.rpc.RetryInfo"):
                duration = str(detail.get("retryDelay", ""))
                if re.fullmatch(r"\d+(?:\.\d+)?s", duration):
                    delays.append(float(duration[:-1]))
    except (ValueError, AttributeError, TypeError):
        pass
    return max(0.0, *delays)


def _daily_reset_delay() -> float:
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=1, microsecond=0)
    return (tomorrow - now).total_seconds()


class GeminiPool:
    """Keys of unknown project ownership deliberately share one quota cooldown."""

    def __init__(
        self, keys: list[str] | None = None, *, client: httpx.AsyncClient | None = None,
        cooldown_seconds: float = 60.0,
    ) -> None:
        if keys is None:
            keys = re.split(r"[\s,;]+", os.environ.get("GEMINI_API_KEYS", os.environ.get("GEMINI_API_KEY", "")))
        unique = list(dict.fromkeys(key.strip() for key in keys if key.strip()))
        self._keys = [Credential(key, "key-" + hashlib.sha256(key.encode()).hexdigest()[:10]) for key in unique]
        self._cursor = 0
        self._cooldown_until = 0.0
        self.cooldown_seconds = cooldown_seconds
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0), follow_redirects=False)
        self._owns_client = client is None

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    def health(self) -> list[dict[str, Any]]:
        remaining = max(0.0, self._cooldown_until - time.time())
        return [{
            "key_id": key.key_id,
            "status": "disabled" if key.disabled else "cooldown" if remaining else "ready",
            "cooldown_seconds": round(remaining, 2) if not key.disabled else 0,
            "last_error": key.last_error,
            "requests": key.requests,
            "successes": key.successes,
        } for key in self._keys]

    def restore_cooldown(self, until_utc_timestamp: float) -> None:
        """Restore a recorded project/model retry deadline after a server restart."""
        self._cooldown_until = max(self._cooldown_until, until_utc_timestamp)

    def acquire(self, model: str | None = None) -> Credential:
        if not self._keys:
            raise ProviderError("no_credentials", message="No server-side Gemini credentials are configured.")
        remaining = self._cooldown_until - time.time()
        if remaining > 0:
            raise ProviderError("pool_cooldown", retryable=True, retry_after=remaining)
        for _ in self._keys:
            key = self._keys[self._cursor % len(self._keys)]
            self._cursor = (self._cursor + 1) % len(self._keys)
            if not key.disabled and (not model or key.models is None or model in key.models):
                return key
        raise ProviderError("no_healthy_credentials", message="No usable credential can access the selected model.")

    def has_available(self, model: str | None = None) -> bool:
        return time.time() >= self._cooldown_until and any(
            not key.disabled and (not model or key.models is None or model in key.models)
            for key in self._keys
        )

    def _http_error(self, response: httpx.Response, key: Credential) -> ProviderError:
        status = response.status_code
        # Inspect structured reasons internally; never put provider text into events.
        try:
            data = response.json().get("error", {})
            diagnostic = json.dumps(data).lower()
        except (ValueError, TypeError, AttributeError):
            diagnostic = ""
        delay: float | None = None
        retryable = False
        uncertain = False
        if status == 401 or (status == 400 and "api_key_invalid" in diagnostic):
            category = "authentication_failed"
            key.disabled = True
            retryable = self.has_available()
        elif status == 403:
            category = "permission_denied"
            key.disabled = True
            retryable = self.has_available()
        elif status == 429:
            daily = "perday" in diagnostic or "daily" in diagnostic
            category = "daily_quota_exhausted" if daily else "rate_limited"
            delay = retry_delay(response, _daily_reset_delay() if daily else self.cooldown_seconds)
            self._cooldown_until = max(self._cooldown_until, time.time() + delay)
            retryable = True
        elif status in {408, 500, 502, 503, 504}:
            category = "provider_timeout" if status in {408, 504} else "provider_unavailable"
            retryable, uncertain = True, status in {408, 504}
            delay = retry_delay(response)
            self._cooldown_until = max(self._cooldown_until, time.time() + delay)
        elif status == 404:
            category = "model_unavailable"
        elif status == 402:
            category = "billing_unavailable"
        elif status == 400:
            category = "invalid_request"
        else:
            category = "provider_request_failed"
        key.last_error = category
        return ProviderError(category, retryable, delay, key.key_id, uncertain)

    async def preflight(self, model: str | None = None) -> dict[str, Any]:
        """Read-only model discovery; never makes a generation or changes models."""
        errors: list[dict[str, str]] = []
        available: set[str] = set()
        for key in self._keys:
            if key.disabled:
                continue
            try:
                key.requests += 1
                response = await self.client.get(
                    API_BASE + "/models", headers={"x-goog-api-key": key.secret}, params={"pageSize": 1000},
                )
                if response.status_code != 200:
                    raise self._http_error(response, key)
                data = response.json()
                key.models = {
                    item["name"].removeprefix("models/") for item in data.get("models", [])
                    if "generateContent" in item.get("supportedGenerationMethods", [])
                }
                # Google's original endpoint uses supportedGenerationMethods.
                available.update(key.models)
                key.last_error = None
                key.successes += 1
            except ProviderError as exc:
                errors.append({"key_id": key.key_id, "classification": exc.classification})
                if exc.classification in {"rate_limited", "daily_quota_exhausted"}:
                    break
            except httpx.RequestError:
                key.last_error = "network_error"
                errors.append({"key_id": key.key_id, "classification": "network_error"})
            except (ValueError, TypeError, KeyError, AttributeError):
                key.last_error = "invalid_provider_response"
                errors.append({"key_id": key.key_id, "classification": "invalid_provider_response"})
        return {
            "configured": bool(self._keys), "available": model in available if model else bool(available),
            "model": model, "models": sorted(available), "credentials": self.health(), "errors": errors,
        }


class GeminiProvider:
    def __init__(self, pool: GeminiPool, model: str, max_output_tokens: int = 768) -> None:
        self.pool, self.model, self.max_output_tokens = pool, model, max_output_tokens

    async def generate(self, context: dict[str, Any]) -> dict[str, Any]:
        if context.get("model", self.model) != self.model:
            raise ProviderError("model_config_changed")
        key = self.pool.acquire(self.model)
        system, user, prompt_hash = prompt_for(context)
        schema = provider_schema(context)
        body = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "maxOutputTokens": min(int(context.get("max_output_tokens", self.max_output_tokens)), self.max_output_tokens),
                "responseFormat": {"text": {"mimeType": "APPLICATION_JSON", "schema": schema}},
            },
        }
        started = time.perf_counter()
        key.requests += 1
        try:
            response = await self.pool.client.post(
                f"{API_BASE}/models/{self.model}:generateContent",
                headers={"x-goog-api-key": key.secret}, json=body,
            )
        except httpx.RequestError as exc:
            uncertain = not isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout))
            key.last_error = "network_error"
            raise ProviderError("network_error", True, 1.0, key.key_id, uncertain) from None
        if response.status_code != 200:
            raise self.pool._http_error(response, key)
        try:
            data = response.json()
        except ValueError:
            raise ProviderError("invalid_provider_response", True, key_id=key.key_id, uncertain=True) from None
        if not isinstance(data, dict):
            raise ProviderError("invalid_provider_response", True, key_id=key.key_id, uncertain=True)
        usage = data.get("usageMetadata") or {}
        input_tokens, output_tokens = count(usage.get("promptTokenCount")), count(usage.get("candidatesTokenCount"))
        thought_tokens, cached_tokens = count(usage.get("thoughtsTokenCount")), count(usage.get("cachedContentTokenCount"))
        result = {
            "input_tokens": input_tokens, "output_tokens": output_tokens, "thought_tokens": thought_tokens,
            "cached_tokens": cached_tokens, "total_tokens": count(usage.get("totalTokenCount")),
            "elapsed_ms": round((time.perf_counter() - started) * 1000),
            "model": data.get("modelVersion", self.model), "requested_model": self.model,
            "prompt_hash": prompt_hash, "key_id": key.key_id,
            "estimated_cost_usd": price_estimate(self.model, input_tokens, output_tokens, thought_tokens, cached_tokens),
            "actual_cost_usd": None,
        }
        candidates = data.get("candidates") or []
        if not candidates or candidates[0].get("finishReason") not in {None, "STOP"}:
            raise ProviderError("generation_incomplete", True, key_id=key.key_id, usage=result)
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(part.get("text", "") for part in parts if not part.get("thought", False))
        try:
            result["action"] = decode_action(text)
        except ProviderError as exc:
            exc.key_id, exc.usage = key.key_id, result
            raise
        key.successes += 1
        key.last_error = None
        return result
