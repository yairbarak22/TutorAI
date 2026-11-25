Write a study summary of the material of the course "{{course.name}}" that appears in the context.
{{#if params.focus}}Focus on the topic: {{params.focus}}.{{/if}}
Level of detail: {{params.length}}.

Structure:
- A main title (title) that describes the material.
- 3–10 sections. Each section: a heading, a Markdown body (bullets, bold definitions, LaTeX formulas, a short example), and citations with the IDs of the sections it is based on.
- The last section: common mistakes and points for the exam.

{{concepts}}
