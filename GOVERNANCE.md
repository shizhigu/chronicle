# Chronicle governance

Chronicle is an open-source project. This document describes how decisions are made, how the maintainer team works, and how the project relates to the wider community.

---

## Principles

1. **Transparent by default.** Decisions happen in public (PR discussions, ADRs, Discussions). Private deliberation happens only for security, personnel, or legal matters.
2. **Contributor-driven.** Anyone can propose a change. Quality review is what distinguishes proposals that land from proposals that stall — not who made them.
3. **Documented choices beat remembered choices.** Non-trivial decisions become ADRs. See `docs/adr/`.
4. **Kindness is load-bearing.** See `CODE_OF_CONDUCT.md`.

---

## Roles

### Contributor
Anyone who opens a PR, issue, or discussion. That is the entire bar.

### Maintainer
A contributor who has demonstrated taste, consistency, and care over time. Maintainers can review, approve, and merge PRs. They are expected to act as stewards of the project rather than owners.

Becoming a maintainer:
- Sustained, high-quality contributions over ~3 months.
- Nomination by an existing maintainer; confirmed by simple majority of the maintainer team.
- New maintainers start with commit rights on their primary area and expand over time.

Stepping down:
- A maintainer who goes inactive for 6+ months without notice moves to emeritus status. They keep credit and name in `CONTRIBUTORS.md` but not merge rights. Rejoining is lightweight.
- Voluntary step-down is always welcome, always without friction.

### Lead maintainer
One maintainer holds the tiebreaker vote when consensus fails and carries the burden of making hard calls (release naming, incident response, communication with the community on behalf of the project). The role rotates by nomination; not a permanent position.

---

## Decision process

### Routine changes
Pull request → review by at least one maintainer (not the author) → merge when CI is green and review is approved. For changes that touch a single package, that package's CODEOWNERS is sufficient.

### Cross-cutting changes
Changes that touch multiple packages, move architectural boundaries, or modify the public API:
- Require an ADR (proposed status) and at least two maintainer approvals, one of whom is from the affected package's CODEOWNERS.
- Discussed in a public Discussion thread for at least 72 hours before merge, unless hotfix.

### Breaking changes
- Require a changeset marked `major`.
- Must include a migration guide in the changeset entry.
- Announced in the Discussions and Discord before release.

### Release
- Minor and patch releases: cut by any maintainer when the version PR opened by the Release workflow accumulates enough changesets to warrant it.
- Major releases: require lead-maintainer sign-off plus at least one co-signature.

### Tie-breaking
If a decision stalls in disagreement:
1. The participants restate positions in writing.
2. A called vote among the maintainer team, simple majority.
3. If still tied, the lead maintainer decides — and writes down why, in an ADR if architectural.

---

## Funding

Chronicle is currently unfunded. If that changes — grants, sponsorship, commercial partnerships — the terms and recipients will be disclosed here and in `.github/FUNDING.yml`. Core maintainers who also hold a commercial stake will be identified; commercial involvement must not drive feature prioritization away from the community's stated needs.

---

## Forks and relationship to downstream

Chronicle is MIT-licensed. You may fork, extend, re-package, or embed it. We only ask:
- Do not imply official endorsement of a fork unless explicitly given.
- Contributions back to upstream, even small ones, are welcome.
- Security issues you discover downstream that also affect upstream should be reported to us privately (`security@chronicle.sh`) so we can coordinate.

---

## Amending this document

Changes to governance follow the "cross-cutting changes" process above. Governance amendments require an ADR.
