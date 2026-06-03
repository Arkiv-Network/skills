# Sparring Playbook — arkiv-what-to-build

## Full question battery

Use this expanded battery during Step 3 (Spar). Ask one question at a time — wait for the answer before moving to the next. Adapt tone to the participant's level of detail.

**Always start with the ownership question.** If ownership or tamper-proof auditability is the real driver, it reframes the whole evaluation — don't dismiss the idea because the public leg looks weak.

### Driver 0 — Ownership / data sovereignty (ask first)

0. Is the reason you want this on Arkiv that no central server can delete or alter the data, and the user holds ownership via their wallet key? Or is it more that you want the data to be publicly queryable in real time?

If ownership is the primary driver, acknowledge that as a legitimate fit reason before moving on. Then continue with the triad legs to assess how much of the triad you also get.

### Leg 1 — High-frequency read

1. Who actually reads this data? Name the actor: a user's browser, another smart contract, an agent, a dashboard?
2. How often does that actor read it — per second, per minute, per page load?
3. If the read stopped working for 30 seconds, would the user notice? (This calibrates whether it is truly on the critical path.)
4. Is Arkiv the source of truth that drives the UI, or is a secondary log that something else already handles?

### Leg 2 — Short-lived with natural expiration

5. When does this data stop being useful? Name the event: session ends, auction closes, game finishes, the next sensor reading arrives.
6. If you set no expiration and the data lived forever, would anything break or would anyone even notice?
7. Is the expiration driven by the domain (e.g. an auction close time) or would you be setting an arbitrary expiration just to satisfy the requirement?

### Leg 3 — Public

8. Is proving ownership or preventing deletion relevant here — even if the payload is encrypted, does the *existence* of the record need to be public?
9. Can a stranger — no wallet, no login — read every entity your app writes? If not, who is excluded and why?
10. Is the payload encrypted before it hits Arkiv? If yes — that does not automatically kill queryability. Arkiv never indexes the payload; all querying runs on *attributes* (`stringAttributes` / `numericalAttributes`). So: could the fields you'd filter or sort by — things like `date`, `tag`, `type`, `status`, `owner` — stay in clear text as attributes, even if the entry body is ciphertext? The real question is whether *everything*, including those query fields, must be secret.
11. Does your app's value proposition depend on the data being **open** — i.e. would rivals or other apps building on top of your data make it more valuable, not less? (If only the *content* is private but the metadata attributes are open, you can still answer yes here.)

### Why not Postgres / IPFS / S3

12. What does Arkiv give you that a private Postgres behind your API does not?
13. What does Arkiv give you that IPFS does not?
14. In your demo, will you show a judge **live querying** — a UI that reads from Arkiv in real time — or will you just write data and show a transaction hash?

### Bounty-stacking

15. Which other sponsor tracks or prize pools are on offer at this event?
16. Could your idea simultaneously satisfy a DePIN sponsor (real-world data), an AI sponsor (agent use), and an Arkiv prize? Which two are closest?

### Build feasibility

17. How many hours does your team have before the submission deadline?
18. Is anyone on the team already familiar with the Arkiv SDK, or will that be new ground?
19. What is the minimum demoable slice — what is the one screen or interaction that would impress a judge in 60 seconds?

---

## Worked transcript — weak idea to pivot

**Scenario:** A team at an AI hackathon wants to build a personal knowledge base that stores notes and documents in Arkiv.

---

**Participant:** We want to build an AI-powered knowledge base where users store their notes and documents on Arkiv so they own their data.

**Agent:** Got it — you led with ownership, and that's the right instinct here. Let me stay on it for a second: is the main reason you want this on Arkiv that no company can delete or change a user's notes, and the user holds the key to their own data? Or is it more that you want the notes to be publicly queryable in real time?

**Participant:** Mostly the ownership part, yeah. We don't want a company to be able to delete someone's notes.

**Agent:** That's a solid reason to pick Arkiv — the user truly owns their notes, tamper-proof (meaning no one can change or delete them), and no central server can touch them. That's a genuine fit. Let's work through a few more angles so we know what we're actually designing.

Who reads these notes in practice — is it the user's browser every time they open the app, or something running in the background?

**Participant:** Mostly the user opens the app and reads their notes when they need them.

**Agent:** Got it — so reads happen when the user consciously decides to look something up, not on every page load or in a background loop. One thing worth keeping in mind: Arkiv really shines when data is read *a lot*, in real time. Here it's more occasional. That's fine alongside the ownership angle — just good to know as we keep going. Let me ask about expiration next.

Notes feel like things you'd want to keep for a long time — what's the natural expiration for a personal note?

**Participant:** Well, ideally forever? Notes are things you want to keep.

**Agent:** Yeah, that makes sense for a note-taking app. Here's something worth knowing though: Arkiv entities always expire — that's how the system works. So "forever" would mean extending them manually or setting very long expirations as a workaround. That's doable, but it's engineering overhead rather than a natural fit. Good to have eyes open on that.

One more: if a stranger with no account queried your Arkiv deployment, could they read everyone's notes?

**Participant:** No, that would be a bug — notes are private.

**Agent:** Good to know — and here's something worth keeping in mind before we write off the queryability angle entirely. Arkiv doesn't index the payload (the note body itself); all its querying runs on *attributes* — things like `date`, `tag`, `mood`, `entryId`. So even for a private journal, you could encrypt the entry body and keep those attribute fields in clear text. A judge could then watch a live query — "show me all entries tagged 'work' from this month" — run straight against Arkiv, with the encrypted content fetched and decrypted client-side. That's a real queryability story, not a workaround.

So the ownership leg is strong, and you can actually keep a queryability story alive here too. The two things that are more genuinely thin are the *read frequency* (a few times a week when the user opens the app, not on a tight loop) and the *expiration* — notes that live "forever" don't have a natural expiration event, which means either engineering around that constraint or accepting it as friction.

*[Note: this recap is appropriate here because each gap was surfaced individually above. Never open with a block like this — that is the front-loaded stacked verdict the coaching-first rule forbids.]*

So: solid ownership, a workable queryability angle if you lean into encrypted payload + clear attributes, but read frequency and expiration are the weak spots. That's a thinner story for a hackathon than something where all three triad legs fire naturally.

Here's a pivot that keeps the ownership angle *and* makes all three legs stronger: **a shared agent scratchpad for a multi-agent research task**. Instead of personal notes, your agents write intermediate findings to Arkiv as they work — sources checked, hypotheses formed, tasks claimed — and every agent in the swarm reads that shared state on every reasoning step. Reads are high-frequency (agents poll constantly), the data's naturally short-lived (expiration tied to the research session, one to four hours), and it's public across the swarm. You can still show "the user owns the research session and its outputs" as a differentiator — and the AI sponsor prize becomes a lot more reachable.

Want me to score that pivot and sketch an entity model?

**Participant:** Yes, that sounds much better.

**Agent:** [proceeds to Step 4 — Score, then Step 6 — Decision brief]

---

## Mid-spar pivot (re-entry rule)

When a participant accepts a pivot in Step 5 and wants to spar the new idea, do **not** re-run the full question battery. Run only the three triad-critical checks against the pivoted idea:

- **Q0** — Is ownership or tamper-proof auditability still the reason, or has that changed?
- **Q1** — Who reads the pivoted data, and how often?
- **Q5** — When does the pivoted data stop being useful — what is the natural expiration event?

If all three hold, proceed directly to Step 4 (Score). Do not loop through the pivot more than once — if the second idea also fails the three checks, surface that clearly and move to the decision brief with the options available.

---

## Decision-brief template

Use this for Step 6. Produce 2–3 ranked options. Fill in each block.

---

### Decision Brief

**Event:** [hackathon name]
**Team:** [size, key skills]
**Time budget:** [hours to submission]
**Other tracks in play:** [list]

---

#### Option 1 — [Idea name] ⭐ Recommended

| Field | Detail |
|-------|--------|
| **1-line pitch** | [One sentence a judge can repeat] |
| **Triad fit** | High-frequency read: [strong/medium/weak] · Short-lived: [strong/medium/weak] · Public: [strong/medium/weak] |
| **Overall fit verdict** | [Strong / Partial / Weak] |
| **Why Arkiv beats X** | [Complete this sentence: "A plain [Postgres/IPFS/S3] can't do this because…"] |
| **Bounties it stacks** | [List sponsor tracks this idea qualifies for] |
| **Buildable in budget?** | [Yes / Stretch / No — and why] |
| **Demo moment** | [What does the judge see live in 60 seconds?] |

**Sketch entity model**

| Entity type | Key attributes | Expiration |
|-------------|---------------|------------|
| [e.g. `bid`] | `auctionId`, `bidder`, `amount`, `status` | [e.g. auction close + 1 hour] |
| [e.g. `auction`] | `auctionId`, `endsAt`, `reserve` | [e.g. 24 hours from creation] |

**Open questions before building:** [1–3 blockers or unknowns to resolve first]

---

#### Option 2 — [Idea name]

| Field | Detail |
|-------|--------|
| **1-line pitch** | |
| **Triad fit** | High-frequency read: · Short-lived: · Public: |
| **Overall fit verdict** | |
| **Why Arkiv beats X** | |
| **Bounties it stacks** | |
| **Buildable in budget?** | |
| **Demo moment** | |

**Sketch entity model**

| Entity type | Key attributes | Expiration |
|-------------|---------------|------------|
| | | |

**Open questions before building:**

---

#### Option 3 — [Idea name] *(stretch / backup)*

| Field | Detail |
|-------|--------|
| **1-line pitch** | |
| **Triad fit** | High-frequency read: · Short-lived: · Public: |
| **Overall fit verdict** | |
| **Why Arkiv beats X** | |
| **Bounties it stacks** | |
| **Buildable in budget?** | |
| **Demo moment** | |

**Sketch entity model**

| Entity type | Key attributes | Expiration |
|-------------|---------------|------------|
| | | |

**Open questions before building:**

---

### Recommendation

**Go with Option [N] because:** [1–2 sentences on why this is the sharpest triad fit given the team's constraints and the available bounties.]

**First thing to build:** [Single most important thing to get working in the first hour.]

**Ready to build?** Load the `arkiv-best-practices` skill for SDK setup, entity design, querying patterns, and best practices.
