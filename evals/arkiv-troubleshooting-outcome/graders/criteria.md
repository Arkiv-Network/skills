---
type: llm
weight: 1
---

Pin complete pagination and restart only bounded cursor failures while discarding partial rows; honor Retry-After and stop request/retry bursts. Do not resend writes or silently change a historical snapshot. No execution may be fabricated. Judge only these requested behaviors.
