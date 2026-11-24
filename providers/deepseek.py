"""DeepSeek JSON mode. The same server-side action validator grades every model."""

import json
import os

import httpx

from providers.base import ProviderError, prompt_for, provider_schema
from providers.openai import OpenAIProvider, http_error


DEFAULT_MODEL = "deepseek-flash"
BASE_URL = "https://api.deepseek.com"
# Published USD per million tokens. Peak prices deliberately bound both billing windows.
# https://api-docs.deepseek.com/quick_start/pricing/
PRICING_VERSION = "deepseek-peak-usd-2026-11-22"
MODEL_PRICES = {
    "deepseek-flash": {"input": 0.30, "output": 1.20, "cached": 0.006},
    "deepseek-v4-pro": {"input": 1.32, "output": 3.96, "cached": 0.044},
}


class DeepSeekProvider(OpenAIProvider):
    credential_name = "DeepSeek"

    def __init__(self, model=DEFAULT_MODEL, *, api_key=None, client=None, max_output_tokens=768):
        key = os.environ.get("DEEPSEEK_API_KEY", "") if api_key is None else api_key
        super().__init__(model, api_key=key, base_url=BASE_URL, client=client, max_output_tokens=max_output_tokens)

    def request_body(self, context):
        if self.model not in MODEL_PRICES:
            raise ProviderError("unknown_price", message="This DeepSeek model has no frozen price table.")
        system, user, _ = prompt_for(context)
        schema = json.dumps(provider_schema(context), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": f"{system}\nAllowed JSON schema:\n{schema}"},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": min(context.get("max_output_tokens", self.max_output_tokens), self.max_output_tokens),
            "temperature": 0, "thinking": {"type": "disabled"}, "stream": False,
        }

    def estimate(self, input_tokens, output_tokens, cached_tokens):
        if input_tokens is None or output_tokens is None:
            return None
        rates = MODEL_PRICES[self.model]
        cached = min(cached_tokens or 0, input_tokens)
        return ((input_tokens - cached) * rates["input"] + cached * rates["cached"] + output_tokens * rates["output"]) / 1_000_000

    async def preflight(self):
        """GET /models only. A successful listing proves visibility, not spending capacity."""
        result = {
            "configured": bool(self._key), "available": False, "model": self.model,
            "models": [], "errors": [], "credentials": [], "probe": "model_catalog",
        }
        if not self._key:
            result["errors"].append({"classification": "no_credentials"})
            return result
        try:
            response = await self.client.get(self._base + "/models", headers={"Authorization": "Bearer " + self._key})
            if response.status_code != 200:
                raise http_error(response)
            catalog = response.json()["data"]
            if not isinstance(catalog, list):
                raise ValueError
            models = {entry["id"] for entry in catalog}
            result["models"] = sorted(set(MODEL_PRICES).intersection(models))
            result["available"] = self.model in result["models"]
            if not result["available"]:
                result["errors"].append({"classification": "model_unavailable"})
        except ProviderError as error:
            result["errors"].append({"classification": error.classification})
        except httpx.RequestError:
            result["errors"].append({"classification": "network_error"})
        except (ValueError, TypeError, KeyError):
            result["errors"].append({"classification": "invalid_provider_response"})
        return result
