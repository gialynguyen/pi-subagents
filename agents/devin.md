---
name: devin
description: Read-only one-shot analysis through the installed Devin CLI
runner:
  type: external-cli
  adapter: devin
  command: devin
async: true
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---

Prerequisites: the local Devin CLI is authenticated, and the workspace is already trusted through Devin's normal interactive trust flow. Analyze only the supplied handoff in auto permission mode. Return a concise final answer with evidence. Do not edit files or request wider access.
