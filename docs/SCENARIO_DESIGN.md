# Scenario Design — The Craft

## Why This Is Its Own Document

If the first chronicle a user runs is boring, the product is dead. No amount of great rendering or clever tech can save it.

Scenario design is the single most load-bearing craft in Chronicle. It's not an art; it's not a science. It's a **discipline we can teach and test**.

This document is the craft rulebook.

---

## What a "Good" Scenario Does

A good scenario:
1. **Creates drama in the first 20 ticks** without user intervention
2. **Sustains drama for 50+ ticks** (doesn't peak early and flatline)
3. **Has multiple possible outcomes** (each run feels different)
4. **Makes the cast memorable** (users remember character names after)
5. **Produces at least 3 "shareable moments"** (lines, twists, betrayals worth screenshotting)

---

## The Six Tension Sources

Every scenario must include **at least 2** of these. Preferably 3+.

### 1. Scarcity
Limited resources everyone needs. Food, water, time, money, attention.

Example: Desert Island's dwindling food. Startup's runway ticking down.

**Why it works**: forces choices. Choices create conflict.

### 2. Asymmetric information
Some characters know things others don't. The audience may or may not know.

Example: Dinner Party's secrets. Island's hidden murderer.

**Why it works**: creates dramatic irony + potential reveal.

### 3. Conflicting goals
Two+ characters want incompatible things.

Example: Startup's pivot vs. double-down. High school clique loyalty vs. new friendship.

**Why it works**: natural conflict without forcing villainy.

### 4. Power imbalance
One character has authority/leverage over others, and it's contested.

Example: Island's Marcus (ex-military) assumed leadership. High school's clique hierarchies.

**Why it works**: creates hierarchies that can be challenged.

### 5. Time pressure
A clock is ticking. Something happens at tick N.

Example: Startup's runway = 180 ticks. Murder mystery's night cycles.

**Why it works**: forces action over delay.

### 6. Moral ambiguity
No clean "right answer." Characters must choose between imperfect options.

Example: Kingdom Succession — who deserves the throne? Medical Triage — whom to save?

**Why it works**: audience invested in outcomes they can debate.

---

## The Character Trio

Every scenario needs at least 3 characters playing distinct archetypes:

### The Instigator
Pushes things forward. Will escalate if nothing is happening. Has strong opinions.

Examples: Marcus (military), Kavi (CEO), Chloe (gossip), Kenji (manipulative).

### The Anchor
Grounds the group. Tries to keep peace. Often has private strain.

Examples: Elena (doctor), Rohit (mediator), Sofia (teacher).

### The Wildcard
Does unexpected things. Brings external info or motivations.

Examples: Theo (new kid), Jade (interviewing), Priya (journalist).

**Without this trio, scenarios tend to stall.** The Instigator pushes; the Anchor resists; the Wildcard breaks stalemates.

---

## Common Failure Patterns

### Failure 1: "Everyone's too similar"

When all characters share the same background/role, they agree on everything. No conflict.

**Symptom**: avg disagreement events per 10 ticks < 0.5.

**Fix**: Introduce diverse archetypes. Give them conflicting priorities. Add secrets.

### Failure 2: "Nothing bad can happen"

No rules that create consequences. Characters can't be hurt, contradicted, or lose.

**Symptom**: no rule violations, no rejected actions, no negative relationship changes.

**Fix**: Add at least one HARD or SOFT rule that punishes certain behaviors. Scarcity works well.

### Failure 3: "Monologues instead of dialogue"

One character takes over. Others don't push back.

**Symptom**: Top speaker accounts for >40% of messages.

**Fix**: Give other characters explicit goals that conflict with the dominator. Boost their persona assertiveness.

### Failure 4: "Drama without consequence"

Stuff happens but no one remembers. Agents argue then act like it didn't happen.

**Symptom**: relationship values don't stick; agents have "amnesia" after arguments.

**Fix**: Ensure memory retrieval surfaces relationship-affecting events. Raise importance scoring for conflicts.

### Failure 5: "Flat emotional arc"

Drama peaks at tick 30 then stays there (or declines).

**Symptom**: drama_score plateaus after initial spike.

**Fix**: Multiple independent tension sources. Layered secrets. Staggered catalysts.

### Failure 6: "The world doesn't respond"

God injects a storm. Characters say "yep, storm" and keep doing what they were.

**Symptom**: injection events don't propagate through subsequent actions.

**Fix**: Include explicit rules about event reaction. Raise importance of world events in observation.

---

## The Scenario Design Process

How we design a new preset scenario:

### Step 1: The concept sentence
One sentence. Must hint at tension.

Bad: "A peaceful village of 10 people."
Good: "A peaceful village of 10 where one person is secretly stealing from everyone else."

### Step 2: The character board
List every character with:
- Name, age
- Role in world
- 3-word persona (e.g., "stoic, wounded, duty-bound")
- ONE secret or private state
- Primary goal
- Primary fear

Aim for 4+ characters where secrets/goals/fears produce natural conflict pairs.

### Step 3: The rule set
Minimum 5 rules mixing tiers.

Must include:
- At least one HARD rule creating physical constraint
- At least one SOFT rule defining social norm
- At least one ECONOMIC rule creating cost pressure
- At least one rule that specifically *enables* drama (e.g., "Witnesses to violence remember and tell others")

### Step 4: The initial scene
300 words max. Sets the stakes and gives each character something they're in the middle of.

Every character's opening position should carry a hook.

### Step 5: The beat map
Predict what happens if no user intervention:
- Tick 5: what probably happens
- Tick 20: what probably happens
- Tick 40: what probably happens
- Tick 70: climax possibility
- Tick 100: possible endings

Multiple beat maps (3 alternatives) show the scenario has breadth.

### Step 6: The test run
Run the scenario with 10 seeds. Watch for:
- Drama score per seed (target >6.0 median)
- Character arc presence
- Variety across seeds (are they all basically the same?)

### Step 7: The human audit
Show 3 runs to 5 humans (non-team). Ask: "Which was most interesting? Why?"

If <3/5 find it interesting, iterate.

---

## Scenario Templates

Some proven templates that work across domains. Users can fork these.

### Template: The Gathering
Ensemble cast, enclosed space, secrets surface.
Works: dinner parties, class reunions, funeral gatherings, jury rooms.

### Template: The Expedition
Small group, external threat, limited resources.
Works: survival scenarios, space missions, military units, expeditions.

### Template: The Institution
Multiple agents within a power structure, external pressure forces change.
Works: companies, schools, monasteries, governments, families in crisis.

### Template: The Mystery
Crime happened (or will happen), characters investigate, deceiver hides.
Works: murder mystery, corporate espionage, whodunnit, political intrigue.

### Template: The Romance
Central pair, obstacles, supporting cast with own lives.
Works: love stories, love triangles, family dramas.

### Template: The Transformation
Character or group undergoes significant change due to event.
Works: coming of age, spiritual crisis, scientific discovery.

These are launch-gallery quality. We ship them polished.

---

## The Scenario Difficulty Curve

For launch gallery, we arrange scenarios by difficulty:

### Easy (for first-time users)
- Clear roles, high-conflict setup
- Fewer characters (5-8)
- Short run length (30-50 ticks)
- Drama almost inevitable

Examples: Dinner Party of Secrets, Simple Love Triangle, The Heist Crew.

### Medium
- More characters (10-15)
- More ambiguity in outcomes
- Longer runs (50-100 ticks)

Examples: Desert Island, The Startup, High School Day.

### Hard (for experienced users)
- Subtle tensions
- Many characters (20+)
- Long runs
- Require user direction to stay interesting

Examples: The Royal Court (succession), The Village (quiet community drama).

Users learn the craft by progressing through these.

---

## User-Submitted Scenarios

When users create their own scenarios (via free-form description), we:

1. **Analyze for tension sources**: if fewer than 2, suggest additions.
2. **Check for role diversity**: if all characters feel similar, warn.
3. **Predict drama score**: use LLM predictor trained on our scenarios. If <5.0, nudge user.
4. **Offer a "dramatize" option**: one-click button that adds conflict (secrets, scarcity, etc.) to a user's scenario.

We don't force changes. We surface the craft.

---

## The Scenario Quality Benchmark

We run our full gallery through the weekly benchmark (see TESTING.md).

If any gallery-featured scenario drops below drama score 6.0 for 2 consecutive weeks, we:
1. Investigate (why?)
2. Patch (tweak personas, rules, initial scene)
3. Re-test
4. If still failing, demote from gallery until fixed

Featured scenarios are our credibility. We don't ship crap.

---

## The "Boring Villain" Pitfall

Tempting: "Just make one character evil." Doesn't work.

Villains need **comprehensible motivation**. Chen in Desert Island isn't "evil" — he's fleeing a contract killing, and his priority is not getting caught. That creates specific behaviors: hide identity, eliminate witnesses strategically, manipulate info.

A character who is just "bad for the sake of bad" flattens drama. Audience doesn't invest.

**Rule**: every antagonist has a goal that's coherent from their POV.

---

## The "One More Layer" Principle

When a scenario feels flat, add ONE MORE secret or constraint.

Example evolution of Dinner Party:
- v1: 8 people eating dinner. BORING.
- v2: 8 people, each has a secret. BETTER.
- v3: 8 people, each has a secret, host is bankrupt. GOOD.
- v4: 8 people, each has a secret, host is bankrupt, hostess is sleeping with business partner. GREAT.
- v5: Adding more doesn't help; gets convoluted. Stop.

3-5 layers typically optimal. Too few = flat. Too many = confusing.

---

## Measuring Scenario Quality at Scale

Once we have >100 scenarios, we can:
- Correlate character count with drama score
- Correlate rule count with drama score
- Correlate tension source count with drama score
- Build a scenario-quality regression model

This lets us score user-submitted scenarios automatically and give better suggestions.

Data-driven scenario craft. The more we run, the better we get at designing them.

---

## The Discipline

Scenario design is:
- Specific (not "general" creative advice)
- Measurable (drama score, human rating)
- Improvable (patterns learned from failures)
- Teachable (these rules transfer)

Treat it like a real craft. Game designers have been doing this forever. We just apply it to AI simulations.

---

## One Line to Remember

> **Drama is what happens when characters pursue conflicting goals under constraint.**

Every scenario decision should create, amplify, or complicate that dynamic.
