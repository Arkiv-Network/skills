---
name: arkiv-feedback
description: Submit a bug report or feature request to Arkiv-Network/reported-issues via an interactive walkthrough that mirrors the official GitHub issue forms. Use when the user wants to report an Arkiv bug, a network issue, or a product idea. Keywords — report bug, file issue, Arkiv issue, network down, broken, not working, feature request, idea for Arkiv, suggest a change.
---

# Arkiv Feedback

Walk the user through reporting a bug or feature request to [`Arkiv-Network/reported-issues`](https://github.com/Arkiv-Network/reported-issues), then submit it on their behalf — without making them touch GitHub's UI.

The skill mirrors the two GitHub issue forms hosted on the repo (`1-bug.yml`, `2-feature-request.yml`). Keep the questions, options, and required/optional split aligned with those files. If they change, update `references/bug-form.md` and `references/feature-form.md`.

## When to invoke

Trigger on any of these signals from the user:

- "I want to report a bug in Arkiv" / "file an issue" / "Arkiv is broken"
- "the network is down" / "the SDK is throwing X" / "Kaolin/Braga is unreachable"
- "I have an idea for Arkiv" / "I'd like a feature" / "Arkiv should support X"

Do **not** invoke for:

- General usage questions — point the user to the [Arkiv Discord](https://discord.gg/golem) or [docs](https://docs.arkiv.network) instead.
- Issues with applications *built on* Arkiv — those go to the application's own team.
- Security disclosures — those need the private channel; tell the user to email or open a private security advisory directly, do not file a public issue.

## Flow

```
PARSE ARGS → PICK FORM → COLLECT FIELDS → DRAFT BODY → CONFIRM → SUBMIT (gh) | FALLBACK (file + URL) → OUTPUT
```

Run every step in order. Don't skip the confirmation step — this is a public repository, and a misfiled issue is awkward to clean up.

### Step 1 — Parse args

Recognise these inline flags if the user passes them:

| Flag            | Meaning                                                 |
|-----------------|---------------------------------------------------------|
| `--bug`         | Use the bug form, skip the form-pick question           |
| `--feature`     | Use the feature-request form, skip the form-pick question |
| `--title TEXT`  | Pre-fill the issue title (without the `[Bug]:` / `[Idea]:` prefix) |
| `--contact TEXT`| Pre-fill the contact field                              |
| `--db-chain X`  | Pre-fill the DB-chain dropdown (bug only)               |
| `--surface X`   | Pre-fill the Surface dropdown (bug only)                |
| `--version X`   | Pre-fill the SDK/tool version field (bug only)          |
| `--tx X`        | Pre-fill the transaction/entity ID field (bug only)     |

Anything not provided inline is asked interactively. Anything provided is treated as authoritative; do not re-prompt.

### Step 2 — Pick form

If neither `--bug` nor `--feature` was set, ask the user:

> Are you reporting **a bug or unexpected behaviour**, or **suggesting a feature or idea**?

Single-choice. Don't assume defaults.

### Step 3 — Collect fields

Read `references/bug-form.md` or `references/feature-form.md` (whichever applies) and ask each field in order. Rules:

- **Required fields** must be answered. If the user skips one, ask again — do not let an empty required field through.
- **Dropdowns** are presented as numbered options. The user picks a number or types the value.
- **Optional fields** can be skipped; if skipped, render them as `—` in the body.
- **Multi-line fields** (logs, repro steps, "what happened?") let the user paste freely. Do not summarise or rewrite their input.
- Don't editorialise. The maintainer triaging the report needs the user's words, not yours.

### Step 4 — Draft body

Compose the issue body in markdown, using the section structure in the relevant `references/*.md` template. Section headings must match the form labels exactly so triage sees the same shape regardless of whether the issue came through the form UI or this skill.

Title:

- Bug: `[Bug]: <one-line summary>`
- Feature: `[Idea]: <one-line summary>`

If the user didn't supply a one-line summary, ask for one before drafting — never auto-generate it.

### Step 5 — Confirm

Print the rendered title and body in full. Then ask:

> Submit this to `Arkiv-Network/reported-issues`?

If the user says no or wants to edit, loop back to the relevant field and re-ask. Do not submit without explicit confirmation.

### Step 6 — Probe `gh`

Decide which submission path to use:

1. Run `command -v gh` to check the CLI is installed.
2. If installed, run `gh auth status` to check the user is authenticated against `github.com`.

If both succeed, take the happy path (Step 7). Otherwise, take the fallback (Step 8).

### Step 7 — Submit (happy path)

Write the rendered body to a temp file, then create the issue:

```bash
# Bug
gh issue create \
  --repo Arkiv-Network/reported-issues \
  --title "[Bug]: <summary>" \
  --body-file <draft-path> \
  --label "bug,triage,reported-issue"

# Feature
gh issue create \
  --repo Arkiv-Network/reported-issues \
  --title "[Idea]: <summary>" \
  --body-file <draft-path> \
  --label "feature-request,triage,reported-issue"
```

Notes:

- Do not pass `--type bug` (or any `--type` flag). The widely-installed versions of `gh` (≤ 2.86.0) do not support it and the call fails with a usage error. The `bug` label is the source of truth for triage; org-level issue types, if used, can be assigned by maintainers after creation.
- The project-side workflow on [`Arkiv-Network/projects/4`](https://github.com/orgs/Arkiv-Network/projects/4/views/1) auto-adds every new issue from this repo. Do **not** call `gh project item-add` — it is unnecessary and creates duplicate items.

On success, print the issue URL plus a one-line summary of what was filed.

### Step 8 — Fallback (no `gh`)

The probe in Step 6 fails in one of two ways: `gh` is **missing entirely**, or `gh` is **installed but unauthenticated**. Offer to fix whichever one applies — with explicit consent — and only fall through to save-and-paste if the user declines or the platform isn't covered.

**Never run a package install, `sudo`, or `gh auth login` without asking first in the same turn.** No silent escalation.

#### 8a — `gh` is missing

Detect what install path is realistic on this machine, then offer the most direct one:

| Platform | Probe | Offer |
|----------|-------|-------|
| macOS    | `command -v brew` | `brew install gh` |
| Linux + apt | `command -v apt` | Point at <https://github.com/cli/cli/blob/trunk/docs/install_linux.md> — don't auto-run, the apt setup adds a GPG key and a repo and is too much for an inline offer |
| Linux + dnf/pacman | `command -v dnf` / `command -v pacman` | Same — point at the install docs, don't auto-run |
| Windows  | n/a | Print `winget install --id GitHub.cli` as text, don't auto-run |
| macOS without `brew` | — | Print release-tarball link (<https://github.com/cli/cli/releases>) |

When an auto-run is on the table (macOS + `brew`), ask once:

> `gh` isn't installed. Run `brew install gh` now? (y/N)

Default is **no** — an accidental Enter should not trigger a package install. If they say yes, run `brew install gh`, then continue into 8c. If they say no (or the platform doesn't qualify for auto-run), fall through to 8d.

#### 8b — `gh` is installed but unauthed

Skip the install step. Offer:

> `gh` is installed but not logged in. Run `gh auth login` now? It opens a browser. (y/N)

If yes, continue into 8c. If no, fall through to 8d.

#### 8c — Authenticate, then loop back

Run `gh auth login` interactively. Surface that it opens a browser so the user isn't surprised. When it returns successfully, **loop back to Step 6** — re-probe and continue into Step 7 with the draft we already collected. Don't make the user re-run the whole skill or re-answer the form questions.

If `gh auth login` fails or the user cancels, fall through to 8d.

#### 8d — Save-and-paste fallback (declined or unsupported)

1. Save the rendered draft to `./arkiv-feedback-<timestamp>.md` (in the user's current working directory). Use the same section structure as the body — one heading per field — so the user can paste section by section.
2. Print this hand-off, substituting the actual reason and path:

   > Couldn't submit via `gh` (`<reason>`). Your draft is saved at `<path>`. Open <https://github.com/Arkiv-Network/reported-issues/issues/new/choose>, pick the matching form (bug or feature request), and paste each section into the corresponding field. The form will apply the right labels and routing on submit.

3. If `gh` is missing, append a tail line: "If you'd rather try `gh` later, install it via <https://github.com/cli/cli#installation> and re-run this skill."
4. Exit. Do not poll or watch for completion — the user finishes in the browser.

#### Hard rules for this step

- No `curl | sh`, no tarball-and-move-to-`/usr/local/bin`, no source builds. Package manager or release link — nothing in between.
- Don't `brew install gh` if `brew` itself isn't on PATH. One `command -v brew` check is enough.
- Never escalate to `sudo` without prior consent in the same turn — and the offers above don't need it for the supported paths.

## Hard rules

- **Public repo.** Every issue is world-readable. Never paste secrets, private keys, internal URLs, or wallet seed phrases into the body. If the user provides any of these, redact them in the rendered body and warn the user.
- **No security disclosures via this skill.** If the user describes anything that sounds like a vulnerability (auth bypass, key leak, signature forgery, RPC abuse), stop the flow and tell them to disclose privately rather than open a public issue.
- **Don't editorialise.** Use the user's wording. Triage needs the original signal.
- **One issue at a time.** If the user describes two unrelated problems, ask them to file separately.

## See also

- `references/bug-form.md` — bug form fields and body template
- `references/feature-form.md` — feature-request form fields and body template
- `arkiv-best-practices` skill — broader Arkiv context, SDK and entity model
