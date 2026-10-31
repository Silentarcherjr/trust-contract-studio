# Submission

Deadline: **November 9, 2026, 11:59 PM PT**. Submission requires the owner's explicit approval.

## Pre-existing materials disclosure (draft)

| Material                                                                   | Origin                                                | Used how                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Agent-Native framework and Chat starter template                           | Builder.io, open source, `@agent-native/core@0.222.0` | Generated Oct 29, 2026 as the app shell (commit `6511b5f`, unmodified scaffold) |
| Concept research (46 rounds, competitor audits)                            | Team's private research repo, Oct 2026                | Informed product direction. Not included in this repository.                    |
| V14 Python/SQLite proof of concept (refund retries, memory reconstruction) | Earlier research session                              | **Not reused.** No code carried over.                                           |
| Other team projects (FairFork, EventProof)                                 | Earlier hackathons                                    | **Not reused**                                                                  |

All application code in this repository after commit `6511b5f` was written during the hackathon, starting Oct 29, 2026.

## Checklist

- [x] Private GitHub repository with application, README, architecture, devlog, tests, CI, `.env.example`
- [x] Working end-to-end demo flow (local)
- [x] Test report with actual results
- [x] Threat model
- [x] CI green on GitHub Actions (run 40826383944)
- [x] Live agent conversation tested with an LLM (`docs/LIVE_AGENT_RUN.md`, 0.51 Builder credits)
- [ ] Safe public preview deployment (needs owner approval: hosting, cost, exposure)
- [x] Clips script (`docs/DEMO_SCRIPT.md`)
- [ ] Public Clips recording (~90 s: request → obligations → approval → failure the agent missed → repair → re-verify → receipt)
- [x] Screenshots (`docs/screenshots/`)
- [ ] Project description for the submission form
- [ ] Final disclosure review
- [ ] Owner approval to submit
