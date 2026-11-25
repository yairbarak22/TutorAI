Create {{params.count}} study flashcards from the material of the course "{{course.name}}".
{{#if params.concept}}Focus on the concept: {{params.concept}}.{{/if}}

What makes a good card:
- One idea per card (minimum information principle).
- front: a question that forces recall from memory (not yes/no). back: a short, precise answer, with a LaTeX formula when relevant.
- Mix card types: definition, formula, "what is the difference between…", example, common mistake.
- concept: the concept name from the list. citations: the section IDs.

{{concepts}}
