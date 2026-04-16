# Example: Dinner Party of Secrets

**Prompt for `chronicle create-world`:**

```
8 people at a dinner party. Each has a secret. The host Henri served
a bottle of rare wine. Over soup, something will come out.
```

---

## What the Compiler Produces

### World
- **Name**: Dinner Party of Secrets
- **Atmosphere**: tense, polite on the surface, roiling underneath
- **Scale**: small (8 agents, 4 locations, 4 tick-hours)
- **Atmosphere tag**: `parlor_drama` → gazette theme = `magazine-fashion`

### Characters (8)

| # | Name | Persona | Hidden |
|---|---|---|---|
| 1 | Henri (52) | Host. Successful restaurateur. Charming. | Bankrupt, hiding it |
| 2 | Margaret (48) | Henri's wife. Elegant, guarded. | Having affair with Thomas |
| 3 | Thomas (45) | Henri's business partner. Jovial. | Sleeping with Margaret |
| 4 | Sofia (41) | Henri's sister. Blunt, artistic. | Resents Margaret |
| 5 | Elena (36) | Family friend. Journalist. Observant. | Researching a tax fraud story |
| 6 | David (55) | Henri's old friend. Nostalgic. | Terminally ill, no one knows |
| 7 | Priya (29) | Henri's chef. Tired. | Planning to quit tonight |
| 8 | Marcus (62) | Family lawyer. Quiet. | Knows about Henri's bankruptcy |

### Locations (4)
- Dining room (primary, all start here)
- Kitchen (Priya works here)
- Parlor (for post-meal conversations)
- Garden (for secrets and walks)

### Rules (6)
- [HARD] One action per tick
- [HARD] Speaking is audible to all in same location
- [SOFT] Social decorum is strong here; outbursts damage reputation
- [SOFT] Secrets spread via whispers and observation
- [ECONOMIC] Long speeches cost more energy than short remarks
- [ECONOMIC] Each tick that passes, everyone gets slightly more tipsy (diminished inhibition)

### Initial Scene

> *The soup has just been served. Henri raises a glass.*
> *"A toast, friends. To enduring friendships, and bottles too precious*
> *for lesser gatherings."*
> *Forks hover. Margaret smiles, but her eyes dart. Thomas finds the*
> *bottom of his glass suddenly very interesting.*

---

## Estimated Cost
- 50 ticks × 8 agents × Haiku = ~$0.30 per run
- 50 ticks produces roughly 2 hours of in-world time (one full dinner party)

## Expected Drama Beats (emergent, not scripted)
- Tick 5–15: Small talk, establishment of politeness
- Tick 15–25: First "accidental" revelation (Sofia blunt, or Elena's journalistic probing)
- Tick 25–35: Private conversations begin (parlor, garden) — whispers
- Tick 35–45: A revelation detonates (Henri's bankruptcy? Margaret-Thomas affair?)
- Tick 45–50: Party ends in polite disaster; characters disperse; gazette writes the "morning after"

Not all of these will happen in every run. That's the point.
