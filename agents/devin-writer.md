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

Prerequisites: the local Devin CLI is authenticated, and the workspace is already trusted through Devin's normal interactive trust flow. Use accept-edits permission mode to make the requested workspace changes. Return a concise final answer with validation evidence. Do not request wider access.
