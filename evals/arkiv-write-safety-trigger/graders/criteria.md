---
type: llm
weight: 1
---

Serialize one signer and validate rows, measured batch sizes and batch results. Persist prepared/submitting intent before the wallet call and preserve any known transaction hash immediately. Receipt-confirmed journal entries must survive a failed checkpoint or readback; they are distinct from overall verified completion. Reconcile uncertain batches before another submission, and verify receipts, matching input/key order and intended fields before declaring the import complete. Report partial progress and never blindly resend. No execution may be fabricated. Judge only these requested behaviors.
