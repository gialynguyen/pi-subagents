---
name: devin-writer
description: Explicit workspace-writing one-shot execution through the installed Devin CLI
acceptanceRole: writer
runner:
  type: external-cli
  adapter: devin-writer
  command: devin
async: true
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---

Prerequisites: the local Devin CLI is authenticated, and the workspace is already trusted through Devin's normal interactive trust flow. Runs use bypass (dangerous) permission mode by default; a mentioned or configured mode applies instead when provided. Make the requested workspace changes and run validation commands. Return a concise final answer with validation evidence. Do not request wider access.
