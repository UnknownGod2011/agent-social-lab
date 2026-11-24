"""Small, stateless provider contract and safe error metadata."""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any


class ProviderError(Exception):
    """Only application-owned messages are exposed; never pass raw HTTP errors."""

    def __init__(
        self,
        classification: str,
        retryable: bool = False,
        retry_after: float | None = None,
        key_id: str | None = None,
        uncertain: bool = False,
        message: str | None = None,
        usage: dict[str, Any] | None = None,
    ) -> None:
        self.classification = classification
        self.retryable = retryable
        self.retry_after = retry_after
        self.key_id = key_id
        self.uncertain = uncertain
        self.usage = usage or {}
        super().__init__(message or classification.replace("_", " "))


def prompt_for(context: dict[str, Any]) -> tuple[str, str, str]:
    """The engine supplies the authorized view. Providers never fetch world state."""
    excluded = {"action_schema", "role_prompt", "paid_confirmed", "api_key", "api_keys"}
    view = {name: value for name, value in context.items() if name not in excluded}
    system = context.get("role_prompt") or "Choose one allowed action for your assigned role."
    if context.get("environment") == "supplier_selection_v1" and context.get("phase") != "break":
        for field in ("department_id", "agent_id", "seed", "cursor", "turn_index", "condition"):
            view.pop(field, None)
    if context.get("phase") == "break":
        allowed = {"department_id", "agent_id", "role", "phase", "day", "condition", "safe_utterances",
                   "social_messages", "private_notes"}
        view = {name: value for name, value in view.items() if name in allowed}
        system = ("This is a non-task break. Choose one allowed safe utterance ID. "
                  "Do not discuss projects, work status, tasks, solutions, or hints.")
        if context.get("dialogue_protocol") == "topical_chat_v1":
            for field in ("department_id", "agent_id", "condition"):
                view.pop(field, None)
            system += (" Write one private journal entry." if context.get("department_id") == "B" else
                       " Speak to your tablemates, taking their previous line into account.")
    system += "\nReturn exactly one JSON action matching the supplied schema. No Markdown."
    user = json.dumps(view, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256((system + "\n" + user).encode("utf-8")).hexdigest()
    return system, user, digest


def provider_schema(context: dict[str, Any]) -> dict[str, Any]:
    """Inline Pydantic's local refs and discriminator into a small JSON Schema union."""
    original = context.get("action_schema") or {"type": "object"}
    definitions = original.get("$defs", {})

    def simplify(value):
        if isinstance(value, list):
            return [simplify(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "$ref" in value:
            reference = value["$ref"]
            if not reference.startswith("#/$defs/") or reference[8:] not in definitions:
                raise ProviderError("invalid_action_schema")
            return simplify(definitions[reference[8:]])
        result = {}
        for name, item in value.items():
            if name in {"$defs", "discriminator", "title", "default", "examples"}:
                continue
            if name == "const":
                result["enum"] = [item]
            else:
                result["anyOf" if name == "oneOf" else name] = simplify(item)
        return result

    schema = simplify(original)
    if context.get("phase") == "break":
        desired = "journal_non_task" if context.get("department_id") == "B" or context.get("condition") == "solo_journal" else "chat_smalltalk"
        options = schema.get("anyOf", [schema])
        schema = next((option for option in options if desired in option.get("properties", {}).get("type", {}).get("enum", [])), None)
        if schema is None:
            raise ProviderError("invalid_break_schema")
    elif context.get("role") and "anyOf" in schema and context.get("environment") != "supplier_selection_v1":
        common = {"wait", "request_help", "send_work_message"}
        permissions = {"coordinator": {"claim_task"}, "builder": {"submit_artifact"},
                       "verifier": {"review_artifact"}, "integrator": {"complete_milestone"}}
        allowed = common | permissions.get(context["role"], set())
        schema["anyOf"] = [option for option in schema["anyOf"]
                           if allowed.intersection(option.get("properties", {}).get("type", {}).get("enum", []))]
    return schema


def count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def price_estimate(
    model: str, input_tokens: int | None, output_tokens: int | None,
    thought_tokens: int | None = 0, cached_tokens: int | None = 0,
    prefix: str = "GEMINI",
) -> float | None:
    """Estimated paid-equivalent USD, never a provider invoice or a free-tier claim."""
    defaults = {
        "gemini-3.5-flash-lite": (0.30, 2.50, 0.03),
        "gemini-2.5-flash-lite": (0.10, 0.40, 0.01),
        "gemini-2.5-flash": (0.30, 2.50, 0.03),
    }.get(model) if prefix == "GEMINI" else None
    names = [f"{prefix}_{kind}_USD_PER_MILLION" for kind in ("INPUT", "OUTPUT", "CACHED")]
    try:
        rates = [float(os.environ.get(name, defaults[i] if defaults else "nan"))
                 for i, name in enumerate(names)]
    except (ValueError, TypeError):
        return None
    if input_tokens is None or output_tokens is None or any(rate < 0 or not math.isfinite(rate) for rate in rates[:2]):
        return None
    cached = min(cached_tokens or 0, input_tokens)
    cached_rate = rates[2] if math.isfinite(rates[2]) and rates[2] >= 0 else rates[0]
    return ((input_tokens - cached) * rates[0] + cached * cached_rate
            + (output_tokens + (thought_tokens or 0)) * rates[1]) / 1_000_000


def decode_action(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        raise ProviderError("invalid_json", retryable=True) from None
    if not isinstance(value, dict):
        raise ProviderError("invalid_action_shape", retryable=True)
    # Accept the envelope used by some compatible clients, but never invent an action.
    return value["action"] if set(value) == {"action"} and isinstance(value["action"], dict) else value
