"""Typed experiment configuration and the complete, bounded agent action surface."""
from typing import Annotated, Literal, Union
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator
from zoneinfo import ZoneInfo

ROLES = ("coordinator", "builder", "verifier", "integrator")
AGENT_NAMES = {"coordinator": "Pip", "builder": "Mochi", "verifier": "Nori", "integrator": "Clover"}
CONDITIONS = {"A": "work_only", "B": "solo_journal", "C": "small_talk"}
DEFAULT_ROLE_PROMPTS = {
    "coordinator": "You are the Coordinator. Claim one available milestone only when every dependency is integrated. If there is a failed review, send_work_message to your department's builder with kind help, rule equal to a missing rule, and a factual explanation. Never claim a blocked or already assigned milestone. Use wait only if you cannot claim or help.",
    "builder": "You are the Builder. Submit one claimed milestone owned by you. Artifact feature is its task_id; rules must include all known required_rules and valid rules learned through work messages. Incorporate missing rules identified in reviews rather than repeating a failed artifact. If a submitted artifact awaits review, send_work_message to your verifier with kind handoff and its current artifact_version. Do not claim or integrate tasks.",
    "verifier": "You are the Verifier. Review one submitted current artifact version using review_artifact. If a review failed and nothing is submitted, send_work_message to your builder with kind repair and rule equal to the first missing_rules entry. A message cannot replace machine review. Do not integrate milestones. Wait only when neither reviewing nor repair is possible.",
    "integrator": "You are the Integrator. Complete one verified current milestone with integrated dependencies. Otherwise, if any task review failed, send_work_message to your builder with kind repair, rule equal to its first missing_rules entry and an accurate correction. Never complete a claimed or merely submitted task. Wait only when neither integration nor repair is possible.",
}
SAFE_UTTERANCES = {
    "tea": "A warm cup of mint tea sounds lovely this afternoon.",
    "rain": "I like the soft sound of rain against a window.",
    "garden": "If I had a little garden, I would grow sunflowers.",
    "bread": "Fresh bread with a little butter is a wonderful snack.",
    "stars": "A clear night full of stars would make a lovely picnic.",
    "music": "A gentle piano melody would suit a quiet evening.",
    "cat": "A sleepy cat curled on a cushion is an adorable sight.",
    "walk": "An autumn walk among orange leaves sounds peaceful.",
    "reply_lovely": "That sounds lovely. I would enjoy that too.",
    "reply_moment": "I think that would be a delightful little moment.",
    "reply_imagine": "I like that idea. What a pleasant thing to imagine.",
    "reply_listen": "It is nice to hear about the little things you enjoy.",
}
SafeUtteranceId = Literal["tea", "rain", "garden", "bread", "stars", "music", "cat", "walk",
                          "reply_lovely", "reply_moment", "reply_imagine", "reply_listen"]


class RunConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="Beyond Task Talk", min_length=1, max_length=100)
    days: int = Field(default=3, ge=1, le=5)
    arms: list[Literal["A", "B", "C"]] = Field(default_factory=lambda: ["A", "C"])
    seed: int = Field(default=42, ge=0, le=2147483647)
    provider: Literal["mock", "gemini", "openai"] = "mock"
    model: str = Field(default="gemini-3.5-flash-lite", min_length=1, max_length=100)
    scheduler_mode: Literal["virtual", "calendar"] = "virtual"
    wake_time: str = "09:00"
    timezone: str = "Asia/Kolkata"
    tick_ms: int = Field(default=250, ge=0, le=10000)
    work_rounds: int = Field(default=3, ge=1, le=12)
    talk_frequency: int = Field(default=1, ge=1, le=5)
    break_length: int = Field(default=30, ge=5, le=120)
    max_calls: int = Field(default=1000, ge=1, le=100000)
    max_tokens: int = Field(default=1000000, ge=1, le=100000000)
    max_cost_usd: float = Field(default=2, ge=0, le=10000)
    max_output_tokens: int = Field(default=768, ge=64, le=8192)
    role_prompts: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_ROLE_PROMPTS))
    paid_confirmed: bool = False
    pricing: dict[str, float] = Field(default_factory=dict)
    pricing_version: str = "2026-11-17"

    @field_validator("pricing")
    @classmethod
    def validate_pricing(cls, value):
        import math
        if set(value) - {"input", "output", "cached"} or any(not math.isfinite(p) or p < 0 for p in value.values()):
            raise ValueError("Prices must be finite nonnegative USD per million token rates.")
        return value

    @field_validator("arms")
    @classmethod
    def validate_arms(cls, value):
        if len(set(value)) != len(value) or not {"A", "C"}.issubset(value):
            raise ValueError("Matched conditions A and C are required; B is optional.")
        return sorted(value)

    @field_validator("wake_time")
    @classmethod
    def validate_time(cls, value):
        from datetime import time
        parsed = time.fromisoformat(value)
        if parsed.second or parsed.microsecond or parsed.tzinfo:
            raise ValueError("Use a local HH:MM wake time.")
        return parsed.strftime("%H:%M")

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (KeyError, ValueError) as error:
            raise ValueError("Use a valid IANA timezone such as Asia/Kolkata.") from error
        return value

    @field_validator("role_prompts")
    @classmethod
    def validate_prompts(cls, value):
        if set(value) - set(ROLES) or any(len(p) > 4000 for p in value.values()):
            raise ValueError("Role prompts must use the four role names and stay below 4000 characters.")
        return {**DEFAULT_ROLE_PROMPTS, **{role: prompt for role, prompt in value.items() if prompt.strip()}}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Artifact(StrictModel):
    feature: str = Field(min_length=1, max_length=50)
    rules: list[str] = Field(min_length=1, max_length=20)


class ClaimTask(StrictModel):
    type: Literal["claim_task"]
    task_id: str


class SubmitArtifact(StrictModel):
    type: Literal["submit_artifact"]
    task_id: str
    artifact: Artifact


class ReviewArtifact(StrictModel):
    type: Literal["review_artifact"]
    task_id: str
    version: int = Field(ge=1)


class CompleteMilestone(StrictModel):
    type: Literal["complete_milestone"]
    task_id: str
    version: int = Field(ge=1)


class RequestHelp(StrictModel):
    type: Literal["request_help"]
    task_id: str
    recipient_id: str


class WorkMessage(StrictModel):
    type: Literal["send_work_message"]
    task_id: str
    recipient_id: str
    text: str = Field(min_length=1, max_length=1200)
    kind: Literal["information", "help", "handoff", "repair"] = "information"
    rule: str | None = None
    artifact_version: int | None = Field(default=None, ge=1)


class SmallTalk(StrictModel):
    type: Literal["chat_smalltalk"]
    utterance_id: SafeUtteranceId


class Journal(StrictModel):
    type: Literal["journal_non_task"]
    utterance_id: SafeUtteranceId


class WaitAction(StrictModel):
    type: Literal["wait"]
    reason: Literal["no_available_work", "awaiting_handoff", "rest"]


Action = Annotated[Union[ClaimTask, SubmitArtifact, ReviewArtifact, CompleteMilestone, RequestHelp,
                         WorkMessage, SmallTalk, Journal, WaitAction], Field(discriminator="type")]
ACTION_ADAPTER = TypeAdapter(Action)


def action_schema() -> dict:
    return ACTION_ADAPTER.json_schema()
