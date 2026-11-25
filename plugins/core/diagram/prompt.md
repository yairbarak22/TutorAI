Create a {{params.style}} diagram about "{{params.topic}}" from the material of the course "{{course.name}}".

Mermaid rules:
- concept-map / decision-flowchart: start with `flowchart TD`. timeline: start with `timeline`.
- Put every label in double quotes: A["Conditional probability"]. Edge labels: -->|"leads to"|
- At most 15 nodes. Node IDs in ASCII only (A, B, C...).
- No parentheses in text that is not inside quotes.
- Write the labels in the output language.
explanation: 2–4 sentences on how to read the diagram.
citations: the IDs of the sections the diagram is based on.
