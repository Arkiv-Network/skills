# Feature-request form — fields and body template

Mirrors `Arkiv-Network/reported-issues/.github/ISSUE_TEMPLATE/2-feature-request.yml`. If that file changes, update this reference too.

## Form metadata

- **Title prefix:** `[Idea]: `
- **Labels (auto-applied on submit):** `feature-request`, `triage`, `reported-issue`
- **Issue type:** none (don't pass `--type` for features)

## Fields, in order

| # | Field                                       | Type      | R/O | Notes                                                                 |
|---|---------------------------------------------|-----------|-----|-----------------------------------------------------------------------|
| 1 | Contact                                     | Text      | O   | Discord handle, email, or GitHub username for follow-up.              |
| 2 | What problem are you trying to solve?       | Multiline | R   | Lead with the user pain or use case, not the solution.                |
| 3 | What do you have in mind?                   | Multiline | O   | Optional rough sketch of a solution. Don't push for completeness.     |
| 4 | What workarounds or alternatives have you considered? | Multiline | O   | Anything tried, looked at, or ruled out.                              |
| 5 | Anything else                               | Multiline | O   | Links, screenshots, related issues, extra context.                    |

## Body template

Render the body exactly like this. Keep section headings verbatim. For **skipped optional fields**, write `_No response_` on its own line — this matches what the GitHub form itself renders, so a skill-submitted issue is structurally indistinguishable from a form-submitted one.

```markdown
### Contact
{{contact or "_No response_"}}

### What problem are you trying to solve?
{{problem}}

### What do you have in mind?
{{proposal or "_No response_"}}

### What workarounds or alternatives have you considered?
{{alternatives or "_No response_"}}

### Anything else
{{extra or "_No response_"}}
```

## Triage hint for the agent

If the user only has a vague idea and skips the problem field with something like "I dunno, just thought it'd be cool", push back gently and ask for the underlying use case before drafting. A feature request without a problem is hard to triage and will likely sit in the backlog. The user is better served by a five-minute Discord conversation first.
