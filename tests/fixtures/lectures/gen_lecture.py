"""The synthetic fixture lecture of N slides in the 03-lecture-files.md format, for the perf
budgets (the 200- and 300-slide fixtures of 14-quality.md#performance-budgets). Deterministic,
English only, no private corpus content. It writes the same text as `fixtureLecture(n)` in
ui/e2e/mock-core/lectures.ts, so the real app and the mocked core are measured on one lecture.

    python3 tests/fixtures/lectures/gen_lecture.py <slides> <out.md>
"""

import sys
from pathlib import Path

TOPICS = ["Expectation", "Variance", "Covariance", "Correlation", "Conditional probability", "Bayes rule"]
INLINE = [
    r"$E[X]=\sum_x x\,p(x)$",
    r"$\operatorname{Var}(X)=E[X^2]-(E[X])^2$",
    r"$\rho_{XY}=\frac{\operatorname{Cov}(X,Y)}{\sigma_X\sigma_Y}$",
    r"$P(A\mid B)=\frac{P(A\cap B)}{P(B)}$",
]
SENTENCES = [
    "The definition extends to any random variable with a finite second moment",
    "Linearity holds whether or not the variables are independent",
    "We will use this identity repeatedly in the next lecture",
    "Try a small example with two dice before reading the proof",
    "The sample estimate converges to the population value",
]


def slide(n: int) -> str:
    topic = f"{TOPICS[n % len(TOPICS)]} {n}"
    lines = [f'::: {{.slide #s{n} n={n} src="A{n}" title="{topic}"}}', f"## {topic}", ""]
    for b in range(1, 3 + n % 3 + 1):
        math = f" {INLINE[(n + b) % len(INLINE)]}" if b % 2 == 1 else ""
        flag = " .flag" if (n + b) % 11 == 0 else ""
        lines += [f"[{SENTENCES[(n + b) % len(SENTENCES)]}{math}]{{#s{n}b{b}{flag}}}", ""]
    if n % 2 == 0:
        lines.append(f"::: {{.gloss #g-{format(n * 7919, 'x')[-4:]} kind=steps key=s anchor=s{n}b1 by=ai}}")
        lines += [f"**you asked:** how does {topic.lower()} follow here?", "", "1. Expand and collect terms.", ":::", ""]
    if n % 5 == 0:
        lines += [f"::: {{.note #n-{n:04x} anchor=s{n}b2}}", "Check the worked example.", ":::", ""]
    lines += [":::", ""]
    return "\n".join(lines)


def fixture_lecture(slides: int) -> str:
    head = ["---", "lecter: 1", "lecture: 7", "title: Synthetic Fixture", "slides:", "  - slides/07-fixture.pdf", "---", ""]
    return "\n".join(head) + "\n" + "\n".join(slide(n) for n in range(1, slides + 1))


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not argv[0].isdigit() or not 1 <= int(argv[0]) <= 2000:
        print(__doc__.strip().splitlines()[-1].strip(), file=sys.stderr)
        return 2
    Path(argv[1]).write_text(fixture_lecture(int(argv[0])), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
