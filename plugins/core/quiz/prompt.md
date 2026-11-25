Create a quiz of {{params.count}} questions at {{params.difficulty}} difficulty on the material of the course "{{course.name}}".
{{#if params.concept}}All questions focus on the concept: {{params.concept}}.{{/if}}

Requirements:
- About 70% multiple-choice (kind="mcq", exactly 4 options, correct_index 0–3) and 30% short open questions (kind="open", options=[], correct_index=-1).
- Distractors are plausible and based on common mistakes, never silly. Vary the position of the correct answer.
- Questions test understanding and application, not just memorization. Use new numbers and examples, not ones copied from the material.
- explanation: why the answer is correct and why the distractors are wrong.
- model_answer: a complete, short answer.
- concept: the concept being tested, from the concept list.
- citations: the section IDs the question is based on.
- id: q1, q2, ...

{{concepts}}
