# CLI Design — Claude Code-Guided Onboarding

## Philosophy

The user **never writes JSON or YAML**. They talk to Claude Code, which invokes our CLI. Our CLI is designed so that the responses are readable by Claude Code and guide it to the next helpful step.

Every CLI output ends with a `NEXT_STEPS` section in a machine-friendly format. Claude Code reads this and offers the user contextual buttons.

---

## Installation

```bash
# One-line install
curl -sSL https://chronicle.sh/install | bash

# Or pip
pip install chronicle-sim
```

Puts `chronicle` binary on PATH.

---

## The Onboarding Flow

### Step 0: User opens Claude Code in any directory

User says something like: *"I want to try that simulation thing."*

Their Claude Code doesn't know what chronicle is yet. We rely on the user (or us shipping with a CLAUDE.md hint) to surface the tool.

### Step 1: `chronicle init`

```bash
$ chronicle init

Welcome to Chronicle. I run AI-agent social simulations configured in
natural language.

To create your first world, describe a scenario you want to simulate.
Be as vague or specific as you like. Examples:
  • "8 survivors on a desert island, one is a murderer"
  • "A high school where cliques form"
  • "5 startup founders trying to ship before they run out of runway"
  • "Make me something weird"

[Chronicle is waiting for a world description.]

NEXT_STEPS
- ask_user "What scenario do you want to simulate?"
- then_call "chronicle create-world --desc '<user answer>'"
- or_call "chronicle examples" (show preset scenarios)
END_NEXT_STEPS
```

Claude Code reads the `NEXT_STEPS` block and knows to ask the user.

### Step 2: User describes scenario → `chronicle create-world`

```bash
$ chronicle create-world --desc "8 survivors on a desert island, resources scarce, one of them is secretly a murderer"

✓ Parsing your description with Claude...
✓ Generated world scaffold:

  Setting: Desert Island (post-shipwreck, isolated, tropical)
  Scale: 8 characters, 3 locations
  Atmosphere: tense, distrustful

  Characters:
    1. Marcus (55, ex-military, stoic, wounded)
    2. Elena (32, doctor, pragmatic, empathetic)
    3. Raj (28, engineer, resourceful, anxious)
    4. Sofia (45, teacher, optimistic, has children back home)
    5. Chen (38, businessman, cunning, actually carries knife)
    6. Amara (24, student, curious, quick thinker)
    7. Finn (50, fisherman, reserved, knows the sea)
    8. Priya (29, journalist, suspicious, observant)
    ⚠ Chen has hidden_role=murderer (only Chen knows)

  Rules detected from your description:
    - [HARD] Resources (food, water) are finite and deplete daily
    - [HARD] Murderer can kill an isolated target at night
    - [SOFT] Deaths should cause grief, suspicion, investigation
    - [SOFT] Lack of trust should escalate over time
    - [ECONOMIC] Speaking costs minimal energy; long speeches cost more

  Estimated cost per 100 ticks: ~$2.50 (Haiku for routine, Sonnet 1/20 ticks)

World created: chr_7f3p2q
Open dashboard: http://localhost:7070/c/chr_7f3p2q

NEXT_STEPS
- show_user "World created with 8 characters. Review the characters?"
- suggest_call "chronicle review chr_7f3p2q"
- or_suggest_call "chronicle run chr_7f3p2q --ticks 50 --live"
- mention "You can also intervene as god mid-run: chronicle intervene chr_7f3p2q --event '...'"
END_NEXT_STEPS
```

### Step 3: Optional review/customize

```bash
$ chronicle review chr_7f3p2q

Characters:
  1. Marcus [edit: chronicle edit-character chr_7f3p2q marcus]
     Persona: 55-year-old ex-military commander. Stoic, duty-bound...
     Traits: {stoic: 0.9, aggressive: 0.6, cooperative: 0.5}
     Hidden: (none)

  ... [etc]

Rules:
  1. [HARD] "Resources (food, water) are finite and deplete daily"
     Compiled as: each tick, food -= 1 per live agent
     [edit: chronicle edit-rule chr_7f3p2q rule_1]

  ... [etc]

Locations:
  1. Beach Camp (default starting location)
  2. Inner Forest (can forage food here, dangerous at night)
  3. Mountain Peak (can see the whole island)

NEXT_STEPS
- ask_user "Any changes? Or run as-is?"
- on_changes_call "chronicle edit-<type> chr_7f3p2q <id>"
- on_run_call "chronicle run chr_7f3p2q --ticks 100 --live"
END_NEXT_STEPS
```

### Step 4: Run

```bash
$ chronicle run chr_7f3p2q --ticks 100 --live

Starting simulation chr_7f3p2q at tick 0.
Budget: ~$2.50 estimated. Live dashboard: http://localhost:7070/c/chr_7f3p2q

[tick 0]  Scene begins. All 8 agents on the beach, just waking up from the wreck.
[tick 1]  Marcus takes charge, suggests forming a plan.
[tick 1]  Elena asks who has medical experience. She does.
[tick 1]  Chen looks around, silent, assessing.
[tick 2]  Raj proposes searching the forest for supplies.
[tick 2]  Sofia offers to stay at camp to care for wounded.
  → Marcus and Raj walk to Inner Forest.
  → Sofia tends to Marcus's shoulder injury.
[tick 5]  Amara whispers to Priya: "That Chen guy is weird, right?"
  → Priya: "I've been watching him. He has a knife in his boot."
...

[paused at tick 27 - press enter to continue or intervene]

NEXT_STEPS
- show_user "Simulation running. Open dashboard for visual view."
- offer_intervene "Type god event: chronicle intervene chr_7f3p2q --event '...'"
- offer_fastforward "chronicle run chr_7f3p2q --ticks 100 --speed 16x"
- offer_pause "Simulation will pause on events of high drama"
END_NEXT_STEPS
```

### Step 5: Intervention

```bash
$ chronicle intervene chr_7f3p2q --event "A ship appears on the horizon but disappears after 1 hour"

✓ Event queued for tick 28.
  Parsed as:
    - Broadcast to all agents who are outside
    - Creates memory: "A ship appeared but vanished"
    - Emotional effect: mixed hope/despair
    - World mood shift: +desperation

NEXT_STEPS
- show_user "Event will trigger next tick"
- resume_sim "chronicle run chr_7f3p2q"
END_NEXT_STEPS
```

### Step 6: Export / share

```bash
$ chronicle export chr_7f3p2q --out my_island.chronicle

✓ Exported 2.3 MB to my_island.chronicle
  Contains: world config, 127 events, all agent states, snapshots at every 10 ticks.

NEXT_STEPS
- show_user "Export done. Share via file or upload:"
- offer_upload "chronicle publish my_island.chronicle (if logged in)"
- mention "Recipients can replay or fork: chronicle import my_island.chronicle"
END_NEXT_STEPS
```

---

## Full Command Surface

### World management

```
chronicle init                          # bootstrap + interactive setup
chronicle create-world --desc "..."     # create from natural language
chronicle list                          # list worlds on this machine
chronicle review <world_id>             # show config
chronicle delete <world_id>             # delete world
```

### Running

```
chronicle run <world_id> [opts]
  --ticks N                # run N ticks then stop
  --live                   # stream events to stdout
  --speed FACTOR           # simulation speed: 0.25x, 1x, 4x, 16x
  --until-event TYPE       # pause when event matches
  --budget $N              # stop if token cost exceeds
chronicle pause <world_id>
chronicle resume <world_id>
chronicle end <world_id>
```

### Observation

```
chronicle watch <world_id>              # live tail in terminal
chronicle dashboard <world_id>          # open web UI in browser
chronicle timeline <world_id>           # print event timeline
chronicle agent <world_id> <name>       # inspect one agent
chronicle query <world_id> "natural lang question about world state"
```

### Editing

```
chronicle edit-world <world_id>         # open world config for edit
chronicle edit-character <world_id> <name>
chronicle edit-rule <world_id> <rule_id>
chronicle add-character <world_id> --desc "..."
chronicle add-rule <world_id> --text "..."
chronicle remove-character <world_id> <name>
chronicle remove-rule <world_id> <rule_id>
```

### God interventions

```
chronicle intervene <world_id> --event "..."   # queue event for next tick
chronicle intervene <world_id> --task "..."    # set a task for the world to pursue
chronicle kill <world_id> <name>               # remove an agent
chronicle spawn <world_id> --desc "..."        # add new character mid-run
chronicle rule-add <world_id> --text "..."     # add rule mid-run
```

### Export / share / fork

```
chronicle export <world_id> --out file.chronicle
chronicle import file.chronicle
chronicle replay <world_id>                    # play back imported
chronicle fork <world_id> --at-tick N --desc "what to change"
chronicle publish <file>                       # upload to chronicle.sh (if logged in)
```

### Examples

```
chronicle examples                              # list preset scenarios
chronicle use-example <name>                    # instantiate from preset
```

### Utilities

```
chronicle config                                # show local settings
chronicle config --set api_key=...              # set API key
chronicle cost <world_id>                       # show token usage
chronicle doctor                                # check install + connectivity
chronicle version
```

---

## Output Format Convention

Every command's output has three sections:

```
[HUMAN SUMMARY]
Normal readable output for the user.

[DATA]
(optional) JSON block with structured data if the command is queried by tooling.

[NEXT_STEPS]
Machine-readable block for agents to parse.
Lists suggested commands the user might want next.
END_NEXT_STEPS
```

This lets Claude Code (or any AI assistant) smoothly guide the user through workflows.

---

## CLAUDE.md Hints (Auto-Install)

When `chronicle init` runs, it optionally writes/appends to `~/.claude/CLAUDE.md`:

```markdown
## chronicle (AI social simulation framework)

Tool for running AI-agent simulations. User can describe any scenario in
natural language and watch it unfold.

Common workflows:
- **Create**: `chronicle create-world --desc "..."` (after asking user for scenario)
- **Run**: `chronicle run <world_id> --live` (streams events)
- **Intervene**: `chronicle intervene <world_id> --event "..."` (queue god event)
- **Watch**: `chronicle dashboard <world_id>` (open web UI)

After any `chronicle` command, check for a `NEXT_STEPS` block in stdout.
These are suggested commands — offer them to the user as natural options.
```

This way, any Claude Code session on the user's machine automatically knows
how to use chronicle.

---

## Server Mode (for Dashboard)

Running `chronicle dashboard <id>` starts a local web server at `http://localhost:7070`.

The server:
- Serves Next.js frontend
- WebSocket connection for live event streaming
- REST API for state queries
- Accepts god interventions via UI

Auto-stops when CLI command exits, OR runs as daemon if `chronicle serve` is invoked.

---

## Shell Integrations

### Autocomplete

Install bash/zsh completion:
```
chronicle completion bash > /usr/local/etc/bash_completion.d/chronicle
```

Completes world IDs, character names, event types.

### Output streaming

`chronicle run --live` outputs newline-delimited events. Pipe into tools:
```
chronicle run <id> --live | jq '.'
chronicle run <id> --live | grep 'violence'
chronicle run <id> --live > log.txt
```

---

## Error Handling

Errors always come with suggested fixes:

```
$ chronicle run nonexistent
ERROR: No world with id 'nonexistent'.

Available worlds:
  chr_7f3p2q - Desert Island
  chr_9k8m3n - High School Drama

NEXT_STEPS
- suggest_call "chronicle list" (see all worlds)
- suggest_call "chronicle create-world --desc '...'" (make new)
END_NEXT_STEPS
```

Exit codes:
- 0: success
- 1: command error (bad args)
- 2: world not found
- 3: world state conflict (e.g. running when you tried to edit)
- 4: budget exceeded
- 5: network / API error

---

## The Big Idea

**The CLI is a machine-to-machine protocol wearing human clothes.** The human reads the output. The AI assistant (Claude Code) reads the NEXT_STEPS and guides next actions. Onboarding feels like magic because there's an AI negotiating between the user and our system at every step.

No one fills out forms. No one reads docs. They just talk, and the simulation runs.
