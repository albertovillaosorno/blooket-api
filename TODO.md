# blooket-api TODO

Only unfinished work is indexed here. Read the linked record for acceptance,
dependencies, blockers, and evidence; preserve its stable ID when completing it.

Execute entries in the displayed order with **IT WORKS** as the functional
acceptance standard: finish usable end-to-end behavior first, then iterate.
Never relax authentication, data preservation, safe updates, or honest evidence.
The final ongoing maintenance task is intentionally never auto-completed.

## P1 - Foundations

## P2 - Blooket publication

### TODO - Authenticated Blooket reads

Make authenticated My Sets, questions, and capabilities actually readable,
with clear stops instead of fabricated remote state.

[Record](docs/todo/open/blooket/reads.mdc)

### TODO - Working Blooket writes and browser fallback

Make real Create Set and question writes work and verify them after reload.
Browser-first is enough; unverified HTTP is optional, not a launch blocker.

[Record](docs/todo/open/blooket/transports.mdc)

### TODO - Mutation pacing and human checkpoints

Make real publication paced, cancellable, and recoverable without duplicate
writes; stop clearly when human action is needed.

[Record](docs/todo/open/blooket/pacing.mdc)

### TODO - Journaled quiz publication

Publish and edit real quizzes from canonical CLI/MCP tools, verify the remote
result, and recover safely when interrupted.

[Record](docs/todo/open/blooket/publication.mdc)

### TODO - Autonomous AI quiz publication

Make the teacher's AI-to-Blooket request actually publish and verify a quiz,
including supported media, progress, and recoverable human stops.

[Record](docs/todo/open/teaching/ai-review.mdc)

## P3 - Delivery

### TODO - Diagnostics and launch at login

Make first run, start/stop, opt-in launch at login, and the online MCP tunnel
work as a usable and reversible teacher-facing workflow.

[Record](docs/todo/open/delivery/lifecycle.mdc)

### TODO - Safe automatic application updates

**Release-critical:** safely install trusted updates and restart without losing
teacher data or the old usable app on failure. This is how improvements reach
the recipient; safe rollback/recovery is a functional requirement.

[Record](docs/todo/open/delivery/updates.mdc)

## P4 - Continuous maintenance (never auto-complete)

### TODO - Ongoing compatibility assurance and product hardening

Keep finding and fixing bugs, adding regressions, improving behavior, UI/UX,
Linux stubs, and theoretical macOS/Safari/ChatGPT assurance. **Never close or
remove this last TODO until Alberto explicitly requests its completion.**
Its perpetual status must not block delivery of working features or updates.

[Record](docs/todo/open/acceptance/teacher.mdc)
