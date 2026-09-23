# First live run

Date: 2026-09-23. Model: `jev-1.13.0`. Both shipped filters, `--limit 5`, from a MacBook with `gh auth token` for GitHub. Reports were written with `--out` and are not committed; the numbers below are copied from them.

## weekend-fixes (freeport, engram, mcp-jest)

56 open issues fetched, 1 removed by preflight (`needs discussion`), 5 judged before the cap.

| Rank | Score | Issue | Jev's answers |
| :-- | :-- | :-- | :-- |
| 1 | 0.91 | freeport#4 Add CONTRIBUTING.md with setup instructions | scope 3 (conf 1.00), under 4h (0.94), fit 0.91 |
| 2 | 0.64 | freeport#5 OpenAI-compatible /v1/models endpoint | scope 2.99 (0.99), 4–12h (0.92), fit 0.91 |
| 3 | 0.63 | freeport#6 Prometheus /metrics endpoint | scope 3 (1.00), 4–12h (1.00), fit 0.90 |
| 4 | 0.62 | freeport#12 Request/response logging option | scope 3 (1.00), 4–12h (1.00), fit 0.89 |
| 5 | 0.59 | freeport#11 Mistral AI provider support | scope 3 (1.00), 4–12h (1.00), fit 0.84 |

5 requests, 5,327 input tokens, about $0.0002, 2.1 s. All five were `show`. The ordering is what the policy intends: the only sub-four-hour issue leads, and the four medium issues order by fit. Whether the effort estimates are right is not something this run can tell; it shows the questions are answerable from issue text with high stated confidence.

## stack-breakers (engram's package.json)

20 candidate releases fetched, 0 removed by preflight, 4 judged, then the run stopped on a contract error (below).

| Release | Outcome | Jev's answers |
| :-- | :-- | :-- |
| @clack/prompts 0.10.1 → 1.8.0 | hide, additive | additive (conf 0.85), affects 0.19 |
| @clack/prompts 0.10.1 → 1.8.1 | needs more info | breaking_documented (0.43), affects 0.17 |
| @ai-sdk/openai 1.3.24 → 2.0.128 | needs more info | additive (0.48), affects 0.79 |
| @ai-sdk/openai 1.3.24 → 4.0.73 | needs more info | additive (0.55), affects 0.74 |

4 requests, 4,548 input tokens, about $0.0002. Three of four came back below the 0.8 confidence gate. All three bodies are changeset-style lists ("### Patch Changes", commit links, thanks) rather than prose about behaviour, and the policy is designed to ask rather than guess on those. That is the intended behaviour, and it also says the `breaks` question will rarely be confident on auto-generated changelogs; a future filter could preflight those bodies straight to `needs-more-info` without paying for the call.

## Finding: the score contract was too strict

The fifth request failed `validateResponse` with `migration_effort: score inconsistent with distribution`. Re-sending the identical request returned a consistent answer, so the failure is intermittent. Jev rounds `score` and each probability to two decimals independently; with three levels the weighted mean of the rounded probabilities can differ from the rounded score by up to 0.02, and the contract copied from jev-by-example allowed 0.01. The tolerance now scales with the number of levels. The same check exists in jev-by-example and would fail the same way on a live run.

Also changed after this run: a response that fails the contract now marks that one item `needs-more-info` and the run continues, instead of stopping. Transport and HTTP errors still stop the run so paid verdicts are saved.

## Observations

- Both runs finished in about two seconds for five requests. Cost is negligible; the cap is about attention, not money.
- For monorepos the releases endpoint returns the 50 newest releases across all packages. Between the dry run and the live run an hour later, the `@ai-sdk/openai` releases entered that window and `ai` left it. A package that releases rarely inside a busy monorepo can be missed entirely. Not fixed in v0.1.
- The seen store worked: reruns of either filter reuse these verdicts and spend the cap on new items.
