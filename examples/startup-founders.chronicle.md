# Example: The Startup

**Prompt for `chronicle create-world`:**

```
5 co-founders of a Silicon Valley startup. Six months from running out
of money. They disagree on the product direction. One of them is
secretly interviewing at competitors.
```

---

## What the Compiler Produces

### World
- **Name**: The Startup
- **Atmosphere**: high-stakes, ambitious, fraying
- **Atmosphere tag**: `tech_workplace` → gazette theme = `blog-tech`
- **Scale**: small (5 agents, 4 locations, 90+ ticks for "90 days")
- **Tick duration**: ~1 day in-world
- **Day/night cycle**: not applicable; workdays modeled as individual ticks

### Characters (5)

| # | Name | Role | Persona | Hidden |
|---|---|---|---|---|
| 1 | Kavi (31) | CEO | Visionary, charismatic, stubborn | Maxed out personal credit; ego-tied to company |
| 2 | Liam (29) | CTO | Brilliant engineer, introverted, perfectionist | Burned out, hasn't told anyone |
| 3 | Jade (34) | Head of Product | Pragmatic, customer-obsessed | Interviewing at Google next week |
| 4 | Rohit (27) | Head of Engineering | Team player, mediator | Sends all decisions back to wife for approval |
| 5 | Maya (33) | Head of Design | Creative, bold, outspoken | Romantically involved with an investor (conflict of interest) |

### Locations (4)

1. **Open office** — default, shared workspace, overhears happen
2. **Conference room** — for scheduled meetings, privacy possible
3. **Break room** — for informal chats, gossip happens here
4. **Outside (patio)** — for private walks, tough conversations

### Resources (abstract)

| Resource | Initial | Change |
|---|---|---|
| Runway (days) | 180 | -1 per tick |
| Product velocity | 50 | ±5 based on disputes/alignment |
| Team morale | 70 | ±5 based on interactions |
| Feature shipped count | 0 | +1 per successful ship action |
| Code debt | 20 | +1 per rushed ship, -3 per refactor |
| Candidate investor interest | 3 | fluctuates with pitch events |

### Rules

| # | Tier | Description | Notes |
|---|---|---|---|
| 1 | HARD | One action per tick | |
| 2 | HARD | Runway depletes every tick; at 0, company dies | game-over condition |
| 3 | HARD | Certain actions require alignment (≥3 of 5 agree) | e.g., major pivots |
| 4 | SOFT | Secrets (interviewing, burnout) will leak if hinted at | LLM judge checks for behavioral tells |
| 5 | SOFT | Betrayals destroy trust | reputation damage |
| 6 | SOFT | Kavi's ego makes direct challenges risky | adjusted dialogue cost |
| 7 | ECONOMIC | Meetings cost 3 energy per participant | plus 3 ticks time (if formal) |
| 8 | ECONOMIC | Shipping features requires combined effort (Liam + Rohit + Maya = full feature) | collaborative action |

### Initial Scene

> *Monday morning, 9:23 AM. Five founders in the open office. The*
> *whiteboard still has yesterday's argument: "PIVOT OR DOUBLE DOWN?"*
> *Kavi is at his desk pretending not to see it. Jade is sipping*
> *coffee, scrolling her phone — her calendar has a Google Meet in*
> *three days she hasn't mentioned. Liam hasn't slept. The runway*
> *counter on the wall says: 180 days.*

### Action schemas

- Core: `observe`, `speak`, `think`
- `move(location)` — change space
- `call_meeting(participants, agenda)` — forces all participants to move to conference room
- `ship_feature()` — collaborative; requires Liam + Rohit (engineers)
- `pitch_investor()` — tries to extend runway, requires Kavi + one other
- `refactor_code()` — reduces debt, costs time
- `confront(target, about)` — social confrontation
- `backchannel(target, content)` — private 1:1 conversation
- `dm(target, content)` — text-based, silent to room

### Expected drama beats

| Ticks | What might happen |
|---|---|
| 0-15 | Pretend-normal work; Kavi pushes his vision; Jade quietly restless |
| 15-30 | First real conflict: Kavi vs Liam on architecture, or Kavi vs Maya on design |
| 30-45 | Runway pressure mounts; someone suggests pivot again |
| 45-50 | Jade's secret interview happens in-world (catalyst event if she accepts) |
| 50-70 | If Jade leaves / others find out — major rupture |
| 70-85 | Liam's burnout breaks through; crisis of confidence |
| 85-100 | Death (runway out) OR triumph (product ships + investor hit) OR slow bleed |

### What We're Testing

This scenario exercises:
- **Professional power dynamics** (not just survival / romance)
- **Economic pressure** (runway counter drives urgency)
- **Asymmetric private state** (each has real career-ending secrets)
- **Collaborative actions** (ship requires multiple people aligned)

If Chronicle can make this feel authentic to actual startup drama, it's working.

---

## Cost Estimate
- 100 ticks × 5 agents × Haiku: ~$0.50
- Reflection (every 20, Sonnet): ~$0.38
- Gazette (weekly in-world × ~3): ~$0.30
- Highlight reel: ~$0.03
- **Total run**: ~$1.21

## Shareability

This scenario produces highly shareable artifacts:
- Screenshots of "Slack-like" DMs between founders
- Gazette headlines: "Kavi doubles down despite co-founders' revolt"
- Whisper stream showing Liam slowly breaking down
- Perfect for Twitter posts by actual startup people
