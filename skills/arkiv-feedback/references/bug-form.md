# Bug form — fields and body template

Mirrors `Arkiv-Network/reported-issues/.github/ISSUE_TEMPLATE/1-bug.yml`. If that file changes, update this reference too.

## Form metadata

- **Title prefix:** `[Bug]: `
- **Labels (auto-applied on submit):** `bug`, `triage`, `reported-issue`
- **Issue type:** `bug` (try first; fall back to no type if the org doesn't have it configured)

## Fields, in order

Ask each in this sequence. `R` = required, `O` = optional.

| # | Field                          | Type      | R/O | Notes                                                                 |
|---|--------------------------------|-----------|-----|-----------------------------------------------------------------------|
| 1 | Contact                        | Text      | O   | Discord handle, email, or GitHub username for follow-up.              |
| 2 | DB-chain                       | Dropdown  | R   | Options below. Default to first if user is unsure.                    |
| 3 | Surface                        | Dropdown  | R   | Options below.                                                        |
| 4 | SDK / tool version             | Text      | O   | E.g. `@arkiv-network/sdk@0.6.5`.                                       |
| 5 | What happened?                 | Multiline | R   | What they did, expected, and actually saw.                            |
| 6 | Steps to reproduce             | Multiline | R   | Minimal repro a teammate could follow.                                |
| 7 | Logs                           | Multiline | O   | Render inside a ` ```shell ... ``` ` block.                            |
| 8 | Transaction / entity ID        | Text      | O   | If a specific tx hash or entity ID is involved.                       |
| 9 | Anything else                  | Multiline | O   | Screenshots (link), recordings, links, extra context.                 |

### DB-chain options

1. Kaolin (testnet)
2. Braga (testnet)
3. Local / devnet
4. Other (please describe in the steps)

### Surface options

1. SDK (`@arkiv-network/sdk`)
2. CLI / tooling
3. Block explorer
4. Documentation
5. Website
6. Other

## Body template

Render the body exactly like this. Keep section headings verbatim. Use `—` for skipped optional fields.

```markdown
### Contact
{{contact-or-em-dash}}

### DB-chain
{{db-chain}}

### Surface
{{surface}}

### SDK / tool version
{{version-or-em-dash}}

### What happened?
{{what-happened}}

### Steps to reproduce
{{repro}}

### Logs
```shell
{{logs-or-em-dash}}
```

### Transaction / entity ID
{{tx-or-em-dash}}

### Anything else
{{extra-or-em-dash}}
```

If the user pastes a stack trace or log output that contains a wallet private key, mnemonic, or any string that looks like a secret, **redact it** in the rendered body (replace with `[redacted]`) and warn the user before showing them the preview.
