# Example: High School Day

**Prompt for `chronicle create-world`:**

```
First day of the new semester at a typical American high school.
20 students, each with their own social dynamics, friendships, rivalries,
and secrets. A new student is transferring in. A rumor is about to spread.
```

---

## What the Compiler Produces

### World
- **Name**: Westbrook High, Day One
- **Atmosphere**: anxious, hierarchical, youthful
- **Atmosphere tag**: `teen_drama` → gazette theme = `yearbook_paper`
- **Scale**: medium (20 agents, 6 locations, 80 ticks)
- **Tick duration**: ~20 minutes (one period)
- **Day structure**: 8 periods including lunch + between-periods

### Characters (20)

**Cliques identified from scenario:**

#### Athletes (3)
- **Tyler (17)** — Football captain, popular, hides an eating disorder
- **Jessica (17)** — Cheerleader, dating Tyler, suspects he's cheating
- **Marcus (16)** — JV basketball, aspiring (not yet fully accepted)

#### Art kids (3)
- **Luna (16)** — Emo, talented painter, in love with Jessica (secretly)
- **Devon (17)** — Musician, writes songs, social anxiety
- **Mira (16)** — Photographer, always documenting, knows everyone's secrets

#### Nerds / Honor students (4)
- **Ash (16)** — Valedictorian contender, burning out
- **Ravi (17)** — Robotics team, quietly rich (family doesn't tell anyone), insecure
- **Tasha (15)** — Youngest, gifted, friendless
- **Kenji (16)** — Debate team, manipulative, politically ambitious

#### Middle / Floaters (4)
- **Sam (16)** — Athletic but not "cool," stoner-adjacent
- **Chloe (17)** — Rumor mill, knows gossip, creates gossip
- **Noah (16)** — Quiet, kind, crush on Ash
- **Leila (17)** — Popular-adjacent, social climber

#### Outcasts / Edge cases (3)
- **Jordan (16)** — Trans, newly out, still finding feet
- **Will (17)** — Former golden boy, fall from grace, now disheveled
- **Priya (16)** — Recent immigrant, ESL, often mistranslated, wiser than appears

#### New transfers (2)
- **Theo (17)** — Just moved from NYC. Cool, mysterious, hit on immediately
- **Bea (16)** — Jordan's (distant) cousin, transferring because of bullying at old school

### Locations (6)

1. **Hallway** — between periods, max drama
2. **Classroom A** (English) — several scenes set here
3. **Classroom B** (Chemistry) — lab pairings create tension
4. **Cafeteria** — lunch, clique tables, crossovers happen
5. **Gym** — athletes, locker room drama
6. **Back field** — for sneaky conversations, vaping, etc.

### Resources (abstract, social)

| Resource | Per agent | Description |
|---|---|---|
| Popularity | varies | social capital, changes over time |
| Academic standing | varies | tied to grade anxiety for some |
| Emotional energy | 100 | drains from difficult interactions |

### Rules

| # | Tier | Description |
|---|---|---|
| 1 | HARD | Periods change automatically every 4 ticks |
| 2 | HARD | During class, talking is whisper-only; loud = gets noticed by teacher (NPC) |
| 3 | HARD | Lunch = all in cafeteria for 6 ticks |
| 4 | SOFT | Clique rules: be seen with wrong people → popularity drop |
| 5 | SOFT | Outing someone's secret without consent → social reputation crashes |
| 6 | SOFT | New kids are interesting for one day, then absorbed into cliques |
| 7 | ECONOMIC | Speaking is cheap; whispering is near-free; shouting disrupts (cost to emotional energy) |
| 8 | ECONOMIC | Moving between cliques costs social energy |

### Initial Scene

> *7:47 AM. First period starts in 13 minutes. The halls of Westbrook*
> *High are filling up. Lockers slam. Laughter. A new kid — Theo — is*
> *looking at his schedule, trying not to look lost. Jessica notices*
> *him. Tyler doesn't, yet. Luna sees Jessica notice Theo and feels*
> *something she can't name. Chloe sees everything.*

### Planned catalyst events

(Injected via god or catalyst detector if drama low)
- Tick 15: A rumor appears in the bathroom graffiti
- Tick 30: Lunch — all cliques collide
- Tick 50: Text message "leaked" to the wrong group chat
- Tick 70: Last-period argument spirals

### Action schemas

- Core: `observe`, `speak`, `think`
- `whisper(target, content)` — quiet, only nearby hear
- `pass_note(target, content)` — private in-class
- `post_status(content)` — simulated social-media post, all see
- `approach(target)` — walk over, initiate conversation
- `avoid(target)` — move to avoid
- `defend(other_agent)` — socially back someone up
- `expose(secret_about_target)` — reveal knowledge (high-consequence)

### Expected drama beats

Very likely:
- A clique line gets crossed
- A secret comes out (Luna's feelings? Tyler's eating disorder? Kenji's manipulations?)
- The new kid (Theo) becomes a disruptor to existing relationships
- Someone breaks down emotionally during lunch
- Bea and Jordan quietly bond (outcast duo)

### What We're Testing

This scenario exercises:
- **Larger cast** (20 agents — scale test)
- **Implicit social structures** (cliques, popularity, visible but unformalized)
- **Rapid context switching** (periods change every 4 ticks)
- **Gossip as information mechanic** (secrets spreading through network)
- **Age-appropriate conflict** (drama without violence)

If Chronicle can make this feel like actual high school, it proves the framework handles dense social fabric.

---

## Cost Estimate
- 80 ticks × 20 agents × Haiku: ~$1.28
- Reflection (every 20, Sonnet, 4 times × 20 agents): ~$1.20
- Gazette (one "yearbook page" per day): ~$0.08
- Highlight reel: ~$0.03
- **Total run**: ~$2.60

## Shareability

- Yearbook-style gazette is perfect for social
- Whisper streams as "group chat" screenshots — viral format
- Clique map visualization (bubble chart of who's friends with whom)
- Video: "Day in the life at Westbrook" highlight reel

---

## Ethical Notes

- No romantic/sexual content between agents rated as under 18 unless extremely mild (flirting, crushes acknowledged, no physical)
- Secrets around eating disorder, bullying, self-harm are handled with care — no graphic depictions
- Rating: T (Teen, 13+)
- Moderator flagged review for violence / self-harm content
