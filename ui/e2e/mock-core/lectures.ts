// Synthetic lecture files in the 03-lecture-files.md format, for the mocked core and the buffer's
// tests. Deterministic, English only, no private corpus content.

/**
 * A small lecture: front matter with two slide files, three slides (the second flagged, with a
 * flagged block, a gloss and a note), and the blank lines the format puts between parts.
 */
export const sampleLecture = [
  "---",
  "lecter: 1",
  "lecture: 7",
  "date: 2026-10-23",
  "title: Covariance and Correlation",
  "slides:",
  "  - slides/07-covariance.pdf",
  "  - slides/07b-examples.pptx",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Covariance"}',
  "## Covariance",
  "",
  "[Covariance measures how two variables move together.]{#s1b1}",
  "",
  "[It is zero for independent variables.]{#s1b2}",
  "",
  ":::",
  "",
  '::: {.slide #s2 n=2 src="A2" title="Properties" .flag}',
  "## Properties",
  "",
  "[$\\operatorname{Cov}(aX+b,cY+d)=ac\\,\\operatorname{Cov}(X,Y)$]{#s2b1}",
  "",
  "[$\\operatorname{Var}(X+Y)=\\operatorname{Var}X+\\operatorname{Var}Y+2\\operatorname{Cov}(X,Y)$]{#s2b2 .flag}",
  "",
  '::: {.gloss #g-7f3a kind=steps key=s anchor=s2b2 model="fake" by=ai vote=+1 variant=1/1}',
  "**you asked:** how do we get the 2Cov term?",
  ":::",
  "",
  "::: {.note #n-91c0 anchor=s2b2}",
  "Try it with numbers.",
  ":::",
  ":::",
  "",
  '::: {.slide #s3 n=3 src="B1" title="Worked example"}',
  "## Worked example",
  "",
  "[Roll two dice and compare the sums.]{#s3b1}",
  "",
  ":::",
  "",
].join("\n");

const TOPICS = ["Expectation", "Variance", "Covariance", "Correlation", "Conditional probability", "Bayes rule"];

const INLINE = [
  "$E[X]=\\sum_x x\\,p(x)$",
  "$\\operatorname{Var}(X)=E[X^2]-(E[X])^2$",
  "$\\rho_{XY}=\\frac{\\operatorname{Cov}(X,Y)}{\\sigma_X\\sigma_Y}$",
  "$P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$",
];

const SENTENCES = [
  "The definition extends to any random variable with a finite second moment",
  "Linearity holds whether or not the variables are independent",
  "We will use this identity repeatedly in the next lecture",
  "Try a small example with two dice before reading the proof",
  "The sample estimate converges to the population value",
];

function slide(n: number): string {
  const topic = `${TOPICS[n % TOPICS.length]} ${n}`;
  const lines = [`::: {.slide #s${n} n=${n} src="A${n}" title="${topic}"}`, `## ${topic}`, ""];
  const blocks = 3 + (n % 3);
  for (let b = 1; b <= blocks; b++) {
    const math = b % 2 === 1 ? ` ${INLINE[(n + b) % INLINE.length]}` : "";
    const flag = (n + b) % 11 === 0 ? " .flag" : "";
    lines.push(`[${SENTENCES[(n + b) % SENTENCES.length]}${math}]{#s${n}b${b}${flag}}`, "");
  }
  if (n % 2 === 0) {
    lines.push(`::: {.gloss #g-${(n * 7919).toString(16).slice(-4)} kind=steps key=s anchor=s${n}b1 by=ai}`);
    lines.push(
      `**you asked:** how does ${topic.toLowerCase()} follow here?`,
      "",
      "1. Expand and collect terms.",
      ":::",
      "",
    );
  }
  if (n % 5 === 0) {
    lines.push(
      `::: {.note #n-${n.toString(16).padStart(4, "0")} anchor=s${n}b2}`,
      "Check the worked example.",
      ":::",
      "",
    );
  }
  lines.push(":::", "");
  return lines.join("\n");
}

/** The fixture lecture of `slides` slides (the keystroke budget uses 200; 14-quality.md). */
export function fixtureLecture(slides: number): string {
  const head = [
    "---",
    "lecter: 1",
    "lecture: 7",
    "title: Synthetic Fixture",
    "slides:",
    "  - slides/07-fixture.pdf",
    "---",
    "",
  ];
  const body: string[] = [];
  for (let n = 1; n <= slides; n++) body.push(slide(n));
  return `${head.join("\n")}\n${body.join("\n")}`;
}
