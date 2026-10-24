# 03 · Lecture files

Each lecture is one Pandoc Markdown file in `lectures/`. UTF-8 and LF line endings on every OS. `pandoc lecture.md -o lecture.pdf` must work without Lecter.

## Front matter

```yaml
---
lecter: 1
lecture: 7
date: 2026-10-23
title: Covariance and Correlation
slides:
  - slides/07-covariance.pdf
  - slides/07b-examples.pptx
---
```

`slides` may be empty (a board-only lecture). Paths are relative to the course root.

## Body

Slides are written into the file when the lecture is created, so the file is complete on its own.

```markdown
::: {.slide #s3 n=3 src="A3" title="Properties"}
## Properties

[$\operatorname{Cov}(aX+b,cY+d)=ac\,\operatorname{Cov}(X,Y)$]{#s3b1}

[$\operatorname{Var}(X+Y)=\operatorname{Var}X+\operatorname{Var}Y+2\operatorname{Cov}(X,Y)$]{#s3b2 .flag}

::: {.gloss #g-7f3a kind=steps key=s anchor=s3b2 model="claude-haiku" by=ai vote=+1 variant=2/2}
**you asked:** how do we get the 2Cov term?

1. Expand $(X+Y-\mu_X-\mu_Y)^2$ ...
:::

::: {.note #n-91c0 anchor=s3b2}
Try it with numbers.
:::
:::
```

Rules:

- `src` uses letters for slide files in front-matter order (`A3` = first file, slide 3).
- Every slide block is a bracketed span with an id. `.flag` marks a flagged block; a slide-level flag goes on the `.slide` div.
- A gloss's first line is always the prompt (`**you asked:** …`) unless it is a note. Feedback for `R` is added as `**feedback:** …` under it.
- Gloss kinds: `ask`, `steps`, `doubt`, `define`, `example`, `write`, `tidy`, `figure`, `source`, `later`. Doubts carry `status=open|answered|uncertain|resolved|office-hours`. Later items carry `due=YYYY-MM-DD`.
- Thread replies are nested `.gloss` divs inside their parent, with `target=thread`.
- Variants are stored in `.lecter/state.db`; the file holds the current variant only.
- Figures: `::: {.figure #f-21 kind=vega-lite src="assets/l07/f-21.vl.json" img="assets/l07/f-21.svg"}` with a caption paragraph.
- A tidied note (`gq`) keeps the original in a folded `::: {.original}` div.

## Naming

Default pattern `{date}-l{number:02}-{title-slug}.md`, for example `2026-10-23-l07-covariance-and-correlation.md`. The pattern is a setting. Users can rename lectures at any time (sidebar rename, `:rename`, F2); links survive because glosses use ids.

## New lecture (`␣fn`, `:new`, dashboard button)

1. Number = highest existing `lecture` + 1. Date = today.
2. Slides = files in `slides/` not linked to any lecture, newest first, pre-selected. The user can add, remove or choose none.
3. Title = the first slide's title, else the first slide file's name, else "Lecture N". Editable before creating.
4. The file is created, slides are parsed into it (visible slide first), and it opens.
