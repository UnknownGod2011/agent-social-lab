"""Four-turn, corpus-calibrated break treatment. Only reviewed phrases can be emitted."""
import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from engine.domain import ROLES

PROTOCOL = "topical_chat_v1"
PROFILE = json.loads(Path(__file__).with_name("topical_chat_v1.json").read_text(encoding="utf-8"))
PROFILE_HASH = hashlib.sha256(json.dumps(PROFILE, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

# Original stimuli. A topic has the same three alternatives in both arms.
TOPICS = {
    "rain": ("a rainy afternoon", ("a window seat with a book", "a walk under an umbrella", "a mug of spiced cocoa")),
    "lunch": ("a picnic", ("peach slices", "a tub of hummus", "a warm baguette")),
    "garden": ("a little balcony garden", ("a pot of basil", "a row of marigolds", "a wild strawberry plant")),
    "market": ("a slow Sunday morning", ("a stroll around the market", "an extra hour in bed", "a pancake breakfast")),
    "music": ("a quiet evening", ("an old jazz record", "a piano tune", "a little acoustic guitar")),
    "winter": ("the first snowfall", ("a walk through fresh snow", "hot apple cider", "a snowman with a crooked grin")),
    "water": ("a day near the water", ("a shady spot by the river", "a little pebble beach", "a picnic by the lake")),
    "cinema": ("a movie night", ("salty popcorn", "a bowl of cherries", "homemade nachos")),
}
SLOTS = ("one", "two", "three")


class MenuChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["chat_smalltalk", "journal_non_task"]
    utterance_id: Literal["one", "two", "three"]


def draw(seed, day, label, total):
    # Independent of process hash randomization, arm identity and task progress.
    key = f"{PROTOCOL}/{seed}/{day}/{label}".encode()
    return int.from_bytes(hashlib.sha256(key).digest(), "big") % total


def style_plan(seed, day):
    moves = []
    for position in range(4):
        counts = PROFILE["opening_counts"] if position == 0 else PROFILE["transition_counts"][moves[-1]]
        token = draw(seed, day, f"move/{position}", sum(counts.values()))
        for move, count in sorted(counts.items()):
            if token < count:
                moves.append(move)
                break
            token -= count
    return moves


def render(topic, facet, move, private, prior):
    if private:
        if move == "question":
            return f"What would I pick for {topic}? Probably {facet}."
        if move == "acknowledgment":
            return f"Oh, I keep coming back to {facet}. Sounds just right for {topic}."
        return f"I'd go for {facet}. That's my idea of {topic}."
    if prior == facet:
        if move == "question":
            return f"Same here. What do you like best about {facet}?"
        if move == "acknowledgment":
            return f"Yeah, {facet} would be my pick too."
        return f"I'd have picked {facet} too. Funny we landed on the same thing."
    if prior:
        if move == "question":
            return f"Would you pick {prior} every time? I'd probably go for {facet}."
        if move == "acknowledgment":
            return f"Oh, {prior} sounds good. I'd go for {facet} myself."
        return f"I can see the appeal of {prior}. My first thought was {facet}."
    if move == "question":
        return f"What's your pick for {topic}? I'd go with {facet}."
    if move == "acknowledgment":
        return f"Oh, I know what I'd pick for {topic}. Definitely {facet}."
    return f"For {topic}, give me {facet}. That's my pick."


def social_memory(agent):
    # The work prompt has its own work-history window. Non-task turns cannot evict work records there.
    return [
        {"day": m["day"], "speaker": m["sender_id"].split("-", 1)[-1], "text": m["text"]}
        for m in agent["memory"] if m.get("break_turn") and (
            m["channel"] == "small_talk" or (m["channel"] == "notes" and m["sender_id"] == agent["id"])
        )
    ][-8:]


def work_break_memory(agent, config):
    mode = config.get("break_memory_mode", "attributed")
    if mode == "withheld":
        return []
    history = social_memory(agent)
    if mode == "anonymous":
        return [{**entry, "speaker": "participant"} for entry in history]
    return history


def turn_menu(state, agent, arm):
    day, seed = state["virtual_day"], state["seed"]
    turn = ROLES.index(agent["role"])
    topic_id = tuple(TOPICS)[draw(seed, day, "topic", len(TOPICS))]
    topic, facets = TOPICS[topic_id]
    preceding = next((m for m in reversed(agent["memory"]) if m.get("break_turn")
                      and m["channel"] == "small_talk" and m["day"] == day), None) if arm == "C" else None
    prior = facets[SLOTS.index(preceding["break_turn"]["choice"])] if preceding else None
    move = style_plan(seed, day)[turn]
    metadata = {"protocol": PROTOCOL, "profile_hash": PROFILE_HASH, "topic": topic_id, "move": move, "turn": turn + 1}
    return {slot: render(topic, facet, move, arm == "B", prior) for slot, facet in zip(SLOTS, facets)}, metadata


def break_view(state, agent, arm, common):
    options, _ = turn_menu(state, agent, arm)
    kind = "journal_non_task" if arm == "B" else "chat_smalltalk"
    schema = MenuChoice.model_json_schema()
    schema["properties"]["type"]["enum"] = [kind]
    view = dict(**common, dialogue_protocol=PROTOCOL, safe_utterances=options, action_schema=schema)
    history = social_memory(agent)
    if arm == "B":
        view["private_notes"] = [m["text"] for m in history]
    elif arm == "C":
        view["social_messages"] = [m for m in history if m["day"] == common["day"]]
    return view
