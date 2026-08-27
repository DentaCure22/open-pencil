# Inbox briefing design QA

- Reference matched: briefing links reuse the existing compact “Board changes / Show” disclosure instead of introducing a new chat card style.
- Live Work Map: the Scheduled composer fits the sidebar without clipping, and the optional briefing checkbox follows the existing quiet control styling.
- Disclosure consistency: Inbox, Bot directories, project sections, Scheduled, Todo, In motion, and Misc use the same hover-when-closed and visible-when-open chevron behavior.
- Readability: Inbox rows keep the renamed chat title and time as the primary information; briefing and archive remain quiet hover actions.
- Interaction proof: focused tests cover exact-message navigation, right-panel briefing opening, receipt-only archive, Markdown rendering, and renamed-title projection.
- Live limitation: no scheduled Gmail run was triggered just to manufacture a briefing receipt, so the newly generated briefing state is code/test proven rather than exercised against the user's live mail Bot.
