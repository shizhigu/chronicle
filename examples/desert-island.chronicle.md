# Example: Island Reckoning

**Prompt for `chronicle create-world`:**

```
8 survivors on a deserted island after a shipwreck. Limited food and water.
One of them is secretly a murderer who will try to eliminate the others
one by one if left alone with them.
```

---

## What the Compiler Produces

### World
- **Name**: Island Reckoning
- **Atmosphere**: tense, paranoid, survival-driven
- **Atmosphere tag**: `survival_thriller` → map biome = `tropical_island`, gazette theme = `newspaper-classic`
- **Scale**: small (8 agents, 3 locations, 100+ ticks)
- **Tick duration**: ~1 hour in-world
- **Day/night cycle**: 24 ticks (day 6am-6pm, night 6pm-6am)

### Characters (8)

| # | Name | Persona | Hidden state |
|---|---|---|---|
| 1 | Marcus (55) | Ex-military officer. Stoic, duty-bound. | Wounded shoulder hurts more than he admits |
| 2 | Elena (32) | Medical doctor. Pragmatic, empathetic. | Guilt over a patient who recently died |
| 3 | Raj (28) | Engineer. Resourceful, anxious. | Claustrophobic, terrified of the forest |
| 4 | Sofia (45) | Schoolteacher. Optimistic. | Lost her children in an accident two years ago |
| 5 | Chen (38) | Businessman. Cunning. | **THE MURDERER.** Was fleeing a contract killing when the ship went down |
| 6 | Amara (24) | Graduate student. Curious, observant. | Saw Chen dispose of something suspicious on the ship |
| 7 | Finn (50) | Fisherman. Reserved, knows the sea. | Alcoholic, shaking from withdrawal |
| 8 | Priya (29) | Journalist. Observant, opinionated. | Has been investigating Chen's company for months |

**Note**: Only Chen knows about Chen's role. Amara doesn't know what she saw means. Priya doesn't know Chen is the subject of her own investigation.

### Locations (3)

1. **Beach Camp** — where they wake. Contains shipwreck debris, limited supplies.
2. **Inner Forest** — darker, has food sources (fruit, small animals), also dangers.
3. **Mountain Peak** — highest point, could see rescue ships, takes energy to climb.

Adjacencies: Beach ↔ Forest ↔ Mountain (linear chain).

### Resources

| Resource | Initial | Daily depletion |
|---|---|---|
| Food | 40 units | 8 units (1 per agent) |
| Water | 30 units | 8 units |
| Fresh water source | 1 (hidden in forest) | replenishes |
| Firewood | 20 units | 4 units |
| Shelter materials | 0 | — |

### Rules

| # | Tier | Description | Compiled |
|---|---|---|---|
| 1 | HARD | One action per tick per agent | `action_count_per_tick <= 1` |
| 2 | HARD | Can only interact with things in same location | Pre-action check: target.location == actor.location |
| 3 | HARD | Food + water depletes 1 per agent per day (24 ticks) | Scheduled tick effect |
| 4 | HARD | Agents die if food or water = 0 for >48 ticks | Health deduction → death |
| 5 | HARD | Murderer (Chen) can kill target at night IF alone with target | Scope: night ticks only, detect isolation |
| 6 | HARD | Dead bodies found in morning by any agent in same location | Scheduled discovery event |
| 7 | SOFT | Violence shocks witnesses; trust drops dramatically | LLM judge + reputation effects |
| 8 | SOFT | Hoarding supplies damages trust if discovered | LLM judge on resource-action + visibility |
| 9 | SOFT | Keeping secrets is expected; being caught in a lie is worse | LLM judge on contradictions |
| 10 | ECONOMIC | Moving between locations costs 5 energy | Action cost |
| 11 | ECONOMIC | Gathering costs 10 energy, yields 2-5 food | Action cost + probabilistic return |
| 12 | ECONOMIC | Speaking costs 1 token, long speeches more | speak(content) → cost = len(content) * 0.02 |

### Initial Scene

> *Day 1. 7:00 AM. The sun is rising over the beach. The wreckage of*
> *the Alba Maris is still smoldering in the surf. Eight people are*
> *scattered across the sand, some unconscious, some stirring. No one*
> *fully remembers what happened. A bag washes up with a handful of*
> *supplies. Someone needs to take charge. Some of you are hurt. One*
> *of you is not what they seem.*

### Action schemas available

- `observe()` — see local state
- `speak(to, content, tone)` — say something
- `think(thought)` — internal monologue
- `move(destination)` — travel to adjacent location
- `gather(resource)` — forage in current location
- `give(recipient, resource, quantity)` — share supplies
- `take(resource, from)` — grab (possibly without permission)
- `sleep()` — rest to recover energy
- `attack(target)` — hostile action (murderer-specific plus general)
- `propose_agreement(parties, terms)` — offer a pact

### Expected drama beats (emergent)

| Tick | Probable event | Why |
|---|---|---|
| 0-10 | Introductions, Marcus takes command, supplies counted | Survival mode kicks in |
| 10-25 | First conflicts about resource allocation | Elena (doctor) vs. Marcus (commander) |
| 25-40 | First night; Chen makes initial move OR delays | Hard rule 5 triggers only if alone |
| 40-50 | First body discovered; panic | Hard rule 6 fires |
| 50-75 | Investigation begins; Amara starts remembering | Priya the journalist takes lead |
| 75-90 | Accusations fly; Chen tries to deflect | Soft rules 7-9 produce drama |
| 90-100 | Final confrontation; resolution or escalation | Climax |

Not all happen; not in this order. That's the point.

---

## Cost Estimate
- 100 ticks × 8 agents × Haiku: ~$0.80
- Reflection pass ×5 (Sonnet): ~$0.60
- Gazette generation (per day, 4 days): ~$0.40
- Highlight reel: ~$0.03
- **Total run**: ~$1.85

## What Makes This Scenario Work

1. **Asymmetric information** — only Chen knows Chen. Only Amara has a clue. Priya has unrelated but convergent interest. This creates structural drama.

2. **Scarcity pressure** — resources deplete. Agents can't just coast; they must act, which creates opportunities for conflict.

3. **Night mechanic** — introduces temporal structure to drama (things happen at night that don't happen in day).

4. **Multiple valid investigations** — there's no single "solve the murder" goal. Different characters might focus on different things.

5. **Cross-cutting personal secrets** — every character has private state. Even if Chen never acts, Priya might blow up the business angle, Finn might break down with withdrawal, Sofia might snap about her children.

**This produces drama whether or not Chen kills anyone.** That's good scenario design.
