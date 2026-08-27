# OpenPencil Domain Glossary

## Object panel

The shared place for viewing and acting on the currently opened object. The panel is not itself an object type.

## Todo

A dormant, chat-linked work record that preserves intent and context without starting work. A Todo may later gain a Plan.

## Plan

The durable, Board-placed representation of a Todo's evolving approach, decisions, evidence, and progress.

## Code Object

An independently placed, runnable Board object. Its visual technology does not decide whether another domain object is a Code Object.

## Bot directory

The canonical Work Map home for one Bot, its chats, Todos, schedules, workspace binding, and optional Board space. A nested Bot directory is a sub-bot with its own independently owned space physically nested inside its parent Bot's space.

_Avoid_: Project, project space, folder

## Board space

The optional normal Board Frame containing the Board objects owned by one Bot directory. It is absent while that directory has no Board objects. A root Bot space lives on the page; a sub-bot space lives inside its parent Bot space.

## Workspace binding

The local association between a Bot directory and one working directory. New chats inherit it whether they begin from the Bot directory or from somewhere inside the bound workspace.

## Chat

An ongoing agent conversation. A chat may belong directly to a Bot directory without becoming its Bot charter or a Todo, and a user move remains its authoritative directory placement.
