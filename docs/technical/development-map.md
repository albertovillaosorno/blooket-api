# Development capability map

- Browser UI/API: `src/ui/teacher-workspace/` and `src/api/browser-service/`.
- Preferences/configuration: `src/settings/teacher-preferences/`,
  `src/api/teacher-configuration/`, and `src/platforms/user-storage/`.
- Library/skills/drafts: `src/api/teacher-library/` and
  `src/platforms/user-library/`.
- Image/GIF output: `src/media/image-renditions/` and `src/media/gif-timeline/`.
- CLI/MCP: `src/cli/json-command-process/` and `src/mcp/`.
- Background process/tunnel: `src/service/` and
  `src/platforms/cloudflare-tunnel/`.
- Unintegrated HTTP/Flight candidates: `src/api/blooket-http-actions/` and
  `src/ir/blooket-flight-records/`.

Existing MCP tools provide library search/read/enrichment, personal skill
list/read/write, and recoverable draft list/read/write. Drafts are not published
quizzes. Continue these implementations rather than recreating their already
validated foundations.
