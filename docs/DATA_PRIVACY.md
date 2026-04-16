# Data & Privacy

## The Principles

1. **Collect the minimum.** If we don't need it, we don't ask for it.
2. **Be transparent.** Users know what we have and why.
3. **Let them delete.** One-click data export + delete, always.
4. **Don't sell.** We never sell user data, period.
5. **Encrypt by default.** At rest (AES-256) and in transit (TLS 1.3).

---

## Data Inventory

### What we collect

#### Essential (always collected)
| Data | Why | Retention |
|---|---|---|
| Account email | Login, password reset | Until account deletion |
| Chronicle content (private worlds) | Their creations | Until they delete |
| Public Chronicle content | Gallery + shares | Permanent (their choice) |
| Usage events (anonymous) | Product analytics | 90 days |
| Billing info (via Stripe) | Payments | 7 years (legal) |

#### Optional (only if user opts in)
| Data | Why | Retention |
|---|---|---|
| Email preferences (marketing) | Product updates | Until unsubscribe |
| Discord/social handles | Community integration | Until removed |
| Profile bio + avatar | Public profile | Until removed |

#### Inferred / derived
| Data | Why | Retention |
|---|---|---|
| Drama scores of user's chronicles | Quality tracking | With the chronicle |
| Usage patterns (private) | Product analytics | 90 days |
| A/B test bucket | Experimentation | 30 days after experiment |

### What we DON'T collect

- Names (unless user volunteers in profile)
- Physical addresses (unless enterprise with billing needs)
- Phone numbers
- IP address beyond transient use (deleted after request)
- Browser fingerprints
- Session recordings
- API key for user's LLM provider (stored locally on their machine in BYOK mode)

---

## How Data Moves

### BYOK (Bring Your Own Key) mode

User provides their own Anthropic/OpenAI/Google/Ollama endpoint.
- API calls happen between user's machine and their chosen provider
- **We never see the prompts, completions, or API key**
- Our server gets: event metadata (tick number, action type, timestamp), but not prompt/completion content

### Chronicle Cloud mode

User pays us for inference. We proxy.
- Our server sees: prompts, completions, usage
- We use provider APIs with our keys
- Content logged only for debugging (7 days) unless user opts out
- Never used for model training (ours or third-parties')

### Which mode is default?
- **Free tier**: BYOK (privacy-preserving, forces user to bring their own API key)
- **Cloud tier**: opt-in proxy; we're transparent about what we see

---

## Public vs Private Chronicles

### Private (default for paid users)
- Content stored encrypted at rest
- Accessible only to creator (and their session)
- Not indexed anywhere
- Not used for aggregated analytics

### Public with link
- Content stored normally
- Accessible by anyone with URL
- Not in gallery search
- Creator can make private or delete anytime

### Public in gallery
- Content is fully public
- Indexed for search/discovery
- Fork-able by anyone
- Creator retains copyright; we have license to display
- Creator can delete (removes from gallery; existing forks unaffected)

---

## User Rights (GDPR / CCPA / elsewhere)

### Right to access
- `chronicle export --all` CLI command downloads everything we have on user
- Web UI: Settings → Download My Data (zip with JSON dumps)
- Delivered within 30 days (usually immediate)

### Right to deletion
- `chronicle account delete` (with confirmation)
- All private chronicles deleted
- Public chronicles: optionally anonymized ("by unknown creator") or deleted (existing forks preserve attribution chain up to last deletion)
- Account, billing info, preferences deleted
- Backups purged within 90 days

### Right to portability
- Export formats: JSON (machine-readable), PDF (human-readable)
- Standard schemas (documented)

### Right to rectification
- User can edit any personal data at any time

### Right to object
- Opt out of analytics (we honor)
- Opt out of model-training usage (always opted out by default)
- Opt out of marketing (we honor)

---

## Minors

- COPPA: we don't knowingly collect data from under-13
- If we learn an under-13 account exists, we delete it + refund any payments
- Teen accounts (13-17): functional but with additional safety defaults (content rating limited to T)
- Parents can request deletion for minors

---

## Security Practices

- Secrets (API keys, passwords): never logged
- Passwords: Argon2id hashing
- Database: encrypted at rest (AES-256)
- Network: TLS 1.3 for all connections
- Regular security audits (annual third-party)
- Bug bounty program (public)
- Incident response: 72-hour disclosure (GDPR standard)

---

## Model Training

### We never train on user data. Full stop.

- User-created chronicles, prompts, personas, interventions: never go into any training run
- Our internal tuning uses synthetic data or explicitly opted-in data (marked clearly)
- No user has "consented" to their creative work training someone else's model

### Provider relationships

- Anthropic, OpenAI, etc. have their own training policies
- **Cloud tier**: we use API endpoints that don't train on data (e.g., Anthropic's zero-retention API)
- **BYOK tier**: user's provider choice determines this; we tell them to check

---

## Cookies and Tracking (web)

### Essential cookies (always on)
- Session token
- CSRF token
- Theme preference

### Analytics cookies (opt-in via banner)
- Anonymous event analytics
- Compliant with browser Do-Not-Track
- No cross-site tracking
- No advertising IDs

### We don't use:
- Facebook pixel
- Google Analytics (directly — we use Plausible or self-host)
- Session replay tools
- Heat mapping tools

---

## Third-Party Services

We use minimal third parties, disclose each one:

| Service | Purpose | What they see |
|---|---|---|
| Stripe | Payments | Name, email, card |
| Cloudflare | CDN, DDoS protection | IP address (briefly) |
| SendGrid | Transactional email | Email, message content |
| Plausible (or similar) | Analytics | Anonymized events |
| Vercel (or similar) | Frontend hosting | Standard web logs |
| AWS S3 | Asset storage | Chronicle assets |

No data broker. No advertiser. No shady SDK.

Full list at chronicle.sh/privacy/third-parties (updated when we add/change).

---

## International Data Transfers

- **EU data**: stored in EU region (Frankfurt)
- **US data**: stored in US region (us-west-2)
- Standard Contractual Clauses for any cross-border transfers
- Data Processing Agreements available for enterprise

---

## Transparency Reports

Quarterly. Public. Includes:
- Number of data access requests
- Number of deletion requests
- Government data requests (so far: zero)
- Security incidents (so far: zero)

This builds trust + deters abuse.

---

## Developer API

When we launch API (v1.5+):
- OAuth 2.0 with scoped tokens
- Rate-limited per account
- Third-party app developers sign agreements not to train on our platform
- User can revoke app access anytime

---

## The Honest Bits

We're a small team. We can't:
- Guarantee zero incidents
- Guarantee response times better than stated
- Comply with every niche regulation immediately

We can:
- Be honest about what we don't yet handle
- Respond quickly to issues
- Improve over time

If you notice something missing, email privacy@chronicle.sh.

---

## Policy Updates

We update policies when:
- New features require new data
- Laws change
- User feedback reveals gaps

Every update:
- Notified via email + in-app banner
- 30 days notice before taking effect
- Change log public at chronicle.sh/privacy/changelog

Material changes require re-consent.

---

## The Bottom Line

- We collect little.
- We protect what we collect.
- We don't sell.
- We don't train.
- We delete on request.
- We explain ourselves.

If we ever break these, we deserve to lose users.
