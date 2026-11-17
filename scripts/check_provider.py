"""Safe local Gemini diagnostics. Never prints credentials or provider error bodies."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from providers.gemini import GeminiPool, GeminiProvider, ProviderError


async def main():
    args = argparse.ArgumentParser()
    args.add_argument("--model", default="gemini-3.5-flash-lite")
    args.add_argument("--generate", action="store_true", help="Make one bounded live generation using the configured free-tier pool")
    options = args.parse_args()
    pool = GeminiPool()
    try:
        result = await pool.preflight(options.model)
        print(json.dumps(result, indent=2))
        if options.generate and result["available"]:
            context = {"role": "coordinator", "phase": "work", "instruction": "Return the wait action with reason no_available_work.",
                       "role_prompt": "Return a single JSON action.", "max_output_tokens": 256,
                       "action_schema": {"type": "object", "properties": {"type": {"type": "string", "enum": ["wait"]},
                           "reason": {"type": "string", "enum": ["no_available_work"]}}, "required": ["type", "reason"], "additionalProperties": False}}
            try:
                answer = await GeminiProvider(pool, options.model, 256).generate(context)
                print(json.dumps({"live_smoke": "passed", **answer}, indent=2))
            except ProviderError as error:
                print(json.dumps({"live_smoke": "blocked", "classification": error.classification,
                                  "retry_after": error.retry_after, "uncertain": error.uncertain, "usage": error.usage}, indent=2))
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
