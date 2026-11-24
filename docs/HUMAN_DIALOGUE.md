# Human dialogue in the break treatment

Topical-Chat contains knowledge-grounded human–human text dialogues. We use aggregate patterns of how people open and respond in short exchanges. The provider selects among reviewed, newly written non-task alternatives. The source conversation text is never sent to a provider. [Original repository](https://github.com/alexa/Topical-Chat) · [Pinned training split](https://github.com/alexa/Topical-Chat/blob/7c939229cbcf6f55f6977b341a5a2f2fe982d53f/conversations/train.json) · [Upstream data license](TOPICAL_CHAT_DATA_LICENSE.txt)

The fitter takes the first four nonempty alternating turns from each eligible training dialogue. A turn containing a question mark is classified as a question. An initial acknowledgment word from a published small vocabulary classifies the next group. All other turns are statements. These labels are reproducible surface cues. They do not establish psychological intent. The 8,628 eligible dialogues yield 34,512 turns and 25,884 adjacent transitions. The model samples its opening move and subsequent transitions from those counts. Seeds fix topics and moves across conditions. The four study speakers replace the two original speakers. Domain, turn count and the elicitation setting limit ecological validity.

Each scheduled speaker chooses among three options. In C the next menu refers to the facet the previous participant actually selected. B writes privately on the same topic and matched move schedule. Valid actions consist of a choice ID and the allowed action type. The server renders reviewed text, rejects additional fields and records the move, option, corpus profile hash and visibility. It never accepts task hints in a generated free-text break message. Work memory and break excerpts have independent prompt windows. Recorded break lines are available during later work according to the frozen attributed, anonymous or withheld memory policy.

## Reproduction

```powershell
.\.venv\Scripts\python.exe scripts/fit_dialogue_profile.py --check
.\.venv\Scripts\python.exe scripts/fit_dialogue_profile.py --input path/to/train.json --check
.\.venv\Scripts\python.exe scripts/validate_dialogue.py path/to/valid_freq.json
```

Both programs check the source file SHA-256 before processing. The validation uses the **frequent-topic validation split**, excluded from fitting, and an equally sized synthetic sample. It measures the actual rendered lines from the offline provider using the same surface classifier. Total variation ranges from zero for equal empirical proportions to one for disjoint distributions. Word counts and transitions can expose a mismatch even when sampling uses a human-derived distribution. The machine-readable result records both histograms and the validation file digest. [Validation results](dialogue_validation.json) · [Validation split](https://github.com/alexa/Topical-Chat/blob/7c939229cbcf6f55f6977b341a5a2f2fe982d53f/conversations/valid_freq.json)

The held-out comparison used 539 four-turn exchanges per source. Both had a median of 15 words per line. Opening and adjacent-transition total variation were 0.00742 and 0.06494, respectively. These checks establish similarity on the measured surface statistics. The dialogue remains a bounded intervention.

Human-rated naturalness, workplace representativeness, spontaneous topic changes, sarcasm, and multilingual validity remain open. A blinded follow-up should rate shuffled synthetic transcripts against matched human excerpts for response contingency, repetition and plausibility. Report rater agreement and document any subsequent stimulus revisions as a new protocol version.
