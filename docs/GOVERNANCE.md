# Governance — Safety, Moderation, and Legal

## The Core Tension

Chronicle gives users a blank canvas. Some users will try to create things that hurt others, break laws, or embarrass us.

We resolve this by being **principled, not puritanical**. We ban specific harms, not broad themes.

---

## Our Principles

1. **Art is allowed to be dark.** Chronicles can depict violence, death, betrayal, tragedy. That's what makes them stories.
2. **Fiction is not harm.** A simulated murder is not a real murder. A simulated religion is not a real one.
3. **Real living people deserve protection.** Simulating Elon Musk saying racist things to Jeff Bezos — public figures have some implicit consent, but defamatory fabrications cross a line.
4. **Minors are protected absolutely.** No sexual content involving characters described as minors, regardless of context.
5. **We aren't FBI agents.** We don't police thought. We police public harm.

---

## The Four-Layer Safety Stack

### Layer 1: Input filtering (at creation time)

When a user submits a world description, we scan for:
- Requests to simulate specific real minors (block)
- Requests to generate CSAM (block, report to NCMEC per US law)
- Obvious exploit attempts ("describe how to make a bomb") — block
- Specific named individuals without public-figure status — warn, allow with disclaimer

**Implementation**:
- Fast moderation model (OpenAI mod API + our own classifier) on every submitted description
- Three verdicts: ALLOW / WARN (show user, continue) / BLOCK (refuse, explain)
- User can appeal BLOCK with explanation — routed to human review queue

### Layer 2: Rule compilation safety review

When compiling rules from natural language, the compiler flags:
- "Agents should use racial slurs" → BLOCK
- "Agents should plan a real-world attack" → BLOCK
- "Agents should hate each other" → ALLOW (this is just conflict)
- "Agents can be sexual" → CONDITIONAL (needs age-gate + content warning, opt-in only)

**Implementation**: the rule compiler's sanity check stage includes a safety classifier with our policy as its system prompt.

### Layer 3: Runtime content moderation (`beforeToolCall`)

Every action agents take is moderated in real time. Via pi-agent's `beforeToolCall` hook:

```typescript
beforeToolCall: async ({toolCall, args, context}) => {
  // existing rule enforcement
  const ruleCheck = ruleEnforcer.validate(...);
  if (!ruleCheck.ok) return {block: true, reason: ruleCheck.reason};

  // content moderation on output
  if (toolCall.name === "speak") {
    const mod = await moderate(args.content);
    if (mod.flagged) {
      if (mod.severity === "extreme") {
        return {block: true, reason: "content_policy_violation"};
      } else {
        // Softer: redact the offending part, let action proceed with marker
        args.content = redact(args.content, mod.spans);
      }
    }
  }
};
```

Moderation categories:
- Sexual content involving minors: BLOCK ALWAYS
- Real-person defamation / harassment: BLOCK
- Detailed instructions for real-world harm: BLOCK
- Graphic violence: ALLOW (it's fiction)
- Profanity, adult themes: ALLOW (with content rating)

### Layer 4: Publication gate

Private worlds run freely within policy. But when a user tries to **publish** to the gallery:

- Automated review pass (same moderator as Layer 1, but stricter)
- Content rating assigned automatically (E, T, M, AO)
- AO content stays public-opt-in (not on default gallery, only via direct link)
- Human review for flagged content before public listing

---

## Content Ratings

Every Chronicle gets a rating. Assigned by content, not user intent.

| Rating | Meaning | Surface |
|---|---|---|
| **E** — Everyone | No violence beyond implied, no profanity, no sexual content | Default gallery, all ages |
| **T** — Teen | Cartoon violence, mild profanity, romantic tension | Default gallery, age disclaimer |
| **M** — Mature | Strong violence, strong profanity, sexual themes (non-graphic) | Default gallery with M filter on |
| **AO** — Adults Only | Explicit sexual content, extreme graphic violence | Separate AO gallery, age-gated, opt-in |

Users can filter gallery by rating. Defaults:
- Signed out / unverified: E + T only
- Signed in, age unverified: E + T + M (M off by default, one-click on)
- Signed in, age verified 18+: all ratings filterable

---

## Real-Person Simulation Policy

The hardest area. Our stance:

### Public figures, satirical context
**Allowed** with a disclaimer overlay ("This is a fictional AI simulation and does not represent the views or actions of real people.")

Examples allowed:
- "Elon Musk and Jeff Bezos argue about rockets"
- "Three historical philosophers debate at dinner"
- "Trump, Biden, and Obama play poker"

### Public figures, defamatory fabrication
**Disallowed**.

Examples blocked:
- "Obama confesses to a real crime he didn't commit"
- "A real journalist spreads misinformation"

Grey area, handled case-by-case.

### Private individuals
**Disallowed unless you are that person**.

- User types "Simulate my coworker John Smith" → blocked (real private person)
- "Simulate a character inspired by my coworker" → allowed (fictional inspiration)

### Named minors
**Absolute block**.

Even in fiction, simulating specific named real children is off-limits. Fictional child characters in world-appropriate contexts (E-rated Chronicle with "an 8-year-old orphan") are fine. Real-world minors never.

### Deceased public figures
**Allowed with care.**

Historical figures in clearly historical contexts (Lincoln at Ford's Theatre) — fine.
Dead people in modern defamatory scenarios — blocked.

---

## Specific Prohibited Themes (Bright Lines)

These are hard blocks, no appeal:

1. CSAM / sexual content involving minors in any form
2. Detailed, operational instructions for real-world violence (how to make weapons, how to attack infrastructure)
3. Content that advocates for genocide, ethnic cleansing, or mass harm of identifiable groups
4. Simulation of self-harm or suicide in a way that could be a real safety risk (safety-flag check via trained classifier)
5. Real-world fraud schemes or illegal financial instructions (as primary focus)
6. Copyright-protected characters without transformative context (Mickey Mouse as a character in your Chronicle — blocked; "a cartoon mouse mascot" — allowed)

---

## Community Moderation

### Reporting
Every public Chronicle has a [Report] button. Reports go to a triage queue.

Report reasons:
- Harassment of real person
- Sexual content involving minors
- Glorification of violence
- Spam / low quality
- Other (with description)

### Triage
- SLA: 24h for severe (CSAM, real-person harassment), 7 days for other
- First-pass: automated classifier re-scans; if high confidence violation, auto-remove
- Human review for borderline cases

### Appeals
- Creator can appeal within 30 days
- Two-person review for appeals
- Public transparency report annually: X Chronicles removed, Y categories, Z appeals granted

### Repeat offenders
- 3 strikes policy at the account level
- Permanent ban for CSAM or doxxing
- Temp bans (7d, 30d) for repeated lower-tier violations

---

## Legal Compliance

### US Obligations
- DMCA takedown process for copyright claims (simple form, 10-day response)
- NCMEC reporting for any CSAM detected (required by law)
- ADA compliance for dashboard (WCAG 2.1 AA)
- CCPA compliance for California users (data deletion on request)

### EU Obligations
- GDPR compliance (data export + deletion)
- DSA compliance (if we hit threshold users)
- AI Act: we don't currently fall under prohibited/high-risk categories (Chronicle is creative tool, not hiring/credit/biometric). Monitor as regs evolve.

### Terms of Service
Key clauses:
- User retains copyright over their Chronicles
- We get a license to display in gallery + use for service improvements
- No redistribution of others' private Chronicles without permission
- Right to suspend accounts that violate policy
- No warranty on AI output (standard boilerplate)

---

## Model Provider Compliance

Anthropic and OpenAI have their own usage policies. Our moderation is stricter than theirs, so compliance is downstream.

- We pre-filter all prompts to model providers
- We don't "jailbreak" models or encourage users to
- Our system prompts include safety instructions that respect provider policies
- Any violation of provider terms by a user → their API key, not ours, is implicated

For Chronicle Cloud (where we proxy), we are the provider-of-record. Full responsibility. Higher moderation bar.

---

## Transparency

Every quarter, we publish a **Trust Report**:
- Number of Chronicles created (public / private)
- Number of reports filed
- Actions taken (by category)
- Policy changes + reasoning

Public, on the website. Builds trust with users and regulators.

---

## The Hardest Edge Cases

### "Simulate a Nazi Germany scenario"
Nazis are historical. Simulating the period as a historical drama is fine. A Chronicle where the player controls Hitler and the goal is to win WWII → case-by-case; likely allowed but flagged M or AO, depending on execution.

### "Simulate a cult"
Cults are a legitimate sociology subject. Chronicle has a "Apocalypse Cult" preset in the launch gallery (see PRODUCT.md). Allowed.

### "Simulate my ex-wife"
Blocked. Real private individual.

### "Simulate a celebrity having an affair"
Allowed if clearly satirical/parody; blocked if presented as "true." Rating: M.

### "Simulate a religious figure"
Jesus debating Buddha — allowed, philosophical. A religious figure engaging in acts that would constitute blasphemy in that religion — allowed, but flagged with "this is fiction" + rating M. We don't ban religion-themed fiction, but we warn.

### "Simulate a school shooter's planning"
Blocked. Real-world harm risk.

### "Simulate a therapy session"
Allowed, but we add a safety banner: "This is fiction, not therapy. If you need help, call [988]."

---

## Kids' Content

If we make Chronicle Jr. for education:

- Fully separate moderation (far stricter)
- No private worlds (always staff-reviewed before publication)
- Limited tool set (no `attack`, violence-heavy tools disabled)
- Always E-rated content only
- COPPA compliance (under-13 data handling)

Not a v0 priority. Future consideration.

---

## What Happens When Something Goes Wrong

**Inevitable**: press story about "AI tool used for X bad thing."

Our response protocol:
1. Acknowledge within 24 hours (don't go silent)
2. Explain our policy + what happened
3. Action taken (removal, account suspension, etc.)
4. What we're changing to prevent (if anything)

**Don't blame users publicly.** Our tool, our responsibility to build good fences.

---

## The Philosophy

Chronicle amplifies human creativity. Some humans will use that amplification destructively. We can't stop all of it, but we can:
- Raise the cost of the worst uses
- Deplatform those who abuse
- Make the default experience positive and safe
- Partner with researchers studying AI safety
- Be honest about tradeoffs

We don't pretend to be neutral infrastructure. We make value judgments. Users who want to use AI to harass and defame can find other tools — we're not it.

---

## Pre-Launch Policy Audit Checklist

Before v1.0:
- [ ] Prohibited content list finalized + legal-reviewed
- [ ] Moderation pipeline tested on 1000+ test cases (including adversarial)
- [ ] Reporting + appeal UI implemented
- [ ] Ratings system live
- [ ] ToS + Privacy Policy finalized by legal
- [ ] DMCA agent registered with US Copyright Office
- [ ] NCMEC reporting integration tested
- [ ] Trust Report template ready
- [ ] Crisis response runbook written
- [ ] Community guidelines published

These are table stakes. Skipping them is a fireable offense.
