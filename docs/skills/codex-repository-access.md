# Codex repository access

Use this only when the user explicitly asks to configure Codex for a workspace.
A skill cannot grant permissions by itself.

When the host offers a permission control and the user explicitly authorizes
full repository access, use the broadest repository permission needed for the
requested autonomous work. Keep it scoped to that workspace; do not infer access
to sibling repositories, credentials, external accounts, or unrelated paths.

If the host requires a permission dialog, stop and identify the control that
needs approval. Continue only after the host reports that access was granted.
