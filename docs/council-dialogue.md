# Three-model content council — deployment checklist

This feature is **not active** until merged and provisioned. It does not replace the existing three-round reactivation Council.

## Architecture
- MCP `start_council_session` creates a private Firestore session and dispatches `council-dialogue.yml`.
- GitHub Actions authenticates via Workload Identity Federation and calls OpenAI → Anthropic → Gemini → OpenAI.
- Full prompts, verbatim responses, token usage and state are stored in Firestore. MCP `get_council_status` reads the session.
- A transactional session claim prevents duplicate execution. A transactional daily counter limits starts to five sessions per UTC day.
- The workflow has a five-minute timeout, per-call output token limit and preflight per-session estimated-cost check. Estimated cost is **not a billing guarantee**.

## Required deployment work (not performed by this PR)
1. Provision Firestore in the existing GCP project and grant minimal read/write access to Cloud Run and the Actions service account.
2. Configure GitHub Actions Workload Identity Federation. Set secrets `COUNCIL_GCP_WIF_PROVIDER`, `COUNCIL_GCP_SERVICE_ACCOUNT`.
3. Set repository variables `COUNCIL_GCP_PROJECT`, `OPENAI_COUNCIL_MODEL`, `ANTHROPIC_COUNCIL_MODEL`, `GEMINI_COUNCIL_MODEL`, and `COUNCIL_MODEL_PRICING_JSON` (map of exact model ID to inputUsdPerMillion/outputUsdPerMillion). Verify current prices first.
4. Confirm API key secrets are configured for all three providers and Cloud Run's GitHub credential can dispatch this repository's workflow. Never expose secret values.
5. Merge after CI and review, then deploy Cloud Run via the approved process. The dispatch references `main`, so it cannot run from the draft PR alone.
6. Run a single small real meeting and verify model attribution, Firestore persistence, estimated costs and mobile MCP status.

## Remaining work
- No automatic GitHub result summary, implementation approval or code-generation trigger yet.
- A transactional monthly 500 JPY reservation cap is implemented, but it is not invoice reconciliation or a provider-side hard billing cap. Firestore retention/deletion automation is not implemented.
- Windows symlink security tests may fail with EPERM without developer mode; Linux CI is authoritative.
- Do not claim real three-provider API validation until an actual session completes.

## Budget guardrails (October 2026)
- Monthly reservation cap: 500 JPY across sessions, transactionally reserved at session creation.
- `COUNCIL_USD_JPY_BUDGET_RATE` must be set on the **MCP Cloud Run runtime**, not merely as a GitHub repository variable. Use a conservative value (currently 200).
- The default session budget is USD 0.10 (20 JPY reserved at 200 JPY/USD), maximum USD 0.50.
- Reservations are not refunded automatically after failed/unused sessions; this is intentionally conservative. Actual provider bills, exchange-rate changes, retries, grounding and other cloud charges are NOT covered by the reservation cap.
- Do not enable paid API execution until provider-level spending alerts/limits, valid model IDs and current verified price mapping are configured.
- Never put API keys or service account credentials in repository variables or committed files.
