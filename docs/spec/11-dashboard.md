# 11 · Course dashboard

Opening a course without a lecture shows its dashboard: everything still owed for the course, gathered from every lecture. Nothing is stored twice. Flags, doubts and glosses stay in lecture files; course-wide items stay in `course.md`. The dashboard is a live view over both (file watcher + `state.db` index), so editing either place updates the other.

## Panels

| Panel | Shows | Actions (button and key) |
|---|---|---|
| Up next | Next lecture number, Later items due before the next class (from the course card), "What it assumes" primer (fast model, cached until lectures change) | New lecture `␣fn`; open primer `↵` |
| Open doubts | Doubts with `status` open or uncertain, newest first | Jump `↵`; resolve `x`; move to office hours `o` |
| Office hours | `course.md` → Office hours + doubts with `status=office-hours` | Reorder `J/K`; copy list `yy`; mark asked `x` |
| Flags | Every flag across lectures | Jump `↵`; unflag `mm`; add to revise `r` |
| Revise | `course.md` → Revise, oldest first | Start session `↵` |
| Lectures | All lectures: date, title, counts of open doubts and flags | Open `↵`; rename `␣fR`; link slides |
| Ask the course | Chat box for course-wide questions | Send `↵`; save answer to `course.md` → Notes `S` |

Navigation: `j/k` rows, `]]/[[` panels, `↵` open, `/` filter, mouse hover buttons on every row.

## Revise sessions (v0)

Start from a lecture, a topic, a flag group or the Revise list. The session opens in the right panel as a chat with the revise role:

1. Lecter gathers the material: the lecture digest, its flags and open doubts, matching textbook sections and past questions (tier 0 + targeted retrieval).
2. The model asks one short question at a time (recall, explain, or a past-paper style question), waits for the answer, then explains what was missed in at most 120 words.
3. When the user shows understanding, it offers to resolve the related doubt or flag (a `note_actions` call the user confirms).
4. The session ends with a summary (stored in `course.md` → Notes) and updated Revise items.

Flashcards with spaced repetition (FSRS) build on this in v1.
