# Security

RuecAI Teacher has no server: course files, the database (`ruecai.db`) and the API key stay on the student's device, and model calls go directly from the browser to the model the student chose (Anthropic's API, or a local model on the student's own computer).

Design rules that every change must keep:
- The API key is stored only in the browser's local storage for this site (never in `ruecai.db`, never in logs, never sent anywhere except `api.anthropic.com`). A local model is contacted only at the address the student configured.
- Model-generated code (interactive widgets) runs only in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, under a CSP that blocks all network access.
- All rendered model output (Markdown, Mermaid SVG) goes through DOMPurify.
- Course material and student input inside prompts are wrapped in tags and treated as data, not instructions.
- Expressions sent to SymPy ("Check my solution") are validated against a whitelist first, then parsed by SymPy against a dictionary that contains only math names. The Pyodide runtime is downloaded from jsDelivr on first use; no student data is sent there.
- No external services besides the chosen model and the Pyodide CDN. Tools may not call `fetch` on their own.
- PR builds are never deployed to the production origin; PRs are checked by CI only.

Found a vulnerability? Please **don't** open a public issue. Use GitHub's private "Report a vulnerability" (Security tab) instead.
