"""Check model visibility and optionally send one short, non-retried live request."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from providers.base import ProviderError
from providers.deepseek import DEFAULT_MODEL, DeepSeekProvider
from providers.gemini import GeminiPool, GeminiProvider


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=["gemini", "deepseek"], default="gemini")
    parser.add_argument("--model")
    parser.add_argument("--generate", action="store_true", help="Authorize one billable request, capped at 64 output tokens")
    options = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    if options.provider == "deepseek":
        model = options.model or DEFAULT_MODEL
        backend = lifecycle = DeepSeekProvider(model, max_output_tokens=64)
        catalog = lifecycle.preflight()
    else:
        model = options.model or "gemini-3.5-flash-lite"
        lifecycle = GeminiPool()
        backend = GeminiProvider(lifecycle, model, 64)
        catalog = lifecycle.preflight(model)
    try:
        result = await catalog
        print(json.dumps(result, indent=2))
        if not result["available"]:
            return 1
        if not options.generate:
            return 0
        expected = {"type": "wait", "reason": "no_available_work"}
        context = {
            "phase": "work", "role": "coordinator", "model": model, "paid_confirmed": True,
            "instruction": "Return the wait action with reason no_available_work.", "max_output_tokens": 64,
            "action_schema": {"type": "object", "properties": {
                name: {"type": "string", "enum": [value]} for name, value in expected.items()
            }, "required": list(expected), "additionalProperties": False},
        }
        try:
            answer = await backend.generate(context)
            success = answer["action"] == expected
            fields = ("model", "prompt_hash", "input_tokens", "output_tokens", "total_tokens", "cached_tokens",
                      "estimated_cost_usd", "actual_cost_usd", "system_fingerprint")
            print(json.dumps({"live_smoke": "passed" if success else "invalid_action", **{k: answer.get(k) for k in fields}}, indent=2))
            return 0 if success else 1
        except ProviderError as error:
            print(json.dumps({"live_smoke": "blocked", "classification": error.classification,
                              "retry_after": error.retry_after, "uncertain_usage": error.uncertain}, indent=2))
            return 1
    finally:
        await lifecycle.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
