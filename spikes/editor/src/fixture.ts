// Synthetic 200-slide lecture in the 03-lecture-files.md format. Deterministic (no randomness),
// English only, no private corpus content.

const TOPICS = [
  "Expectation",
  "Variance",
  "Covariance",
  "Correlation",
  "Conditional probability",
  "Bayes rule",
  "Moment generating functions",
  "Law of large numbers",
];

const INLINE = [
  "$E[X]=\\sum_x x\\,p(x)$",
  "$\\operatorname{Var}(X)=E[X^2]-(E[X])^2$",
  "$\\operatorname{Cov}(aX+b,cY+d)=ac\\,\\operatorname{Cov}(X,Y)$",
  "$\\rho_{XY}=\\frac{\\operatorname{Cov}(X,Y)}{\\sigma_X\\sigma_Y}$",
  "$P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$",
];

const DISPLAY = [
  "$$\\operatorname{Var}(X+Y)=\\operatorname{Var}X+\\operatorname{Var}Y+2\\operatorname{Cov}(X,Y)$$",
  "$$M_X(t)=E\\left[e^{tX}\\right]=\\sum_{k=0}^{\\infty}\\frac{t^k}{k!}E[X^k]$$",
  "$$\\int_{-\\infty}^{\\infty} \\frac{1}{\\sqrt{2\\pi\\sigma^2}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}\\,dx = 1$$",
  "$$\\bar X_n \\xrightarrow{p} \\mu \\quad\\text{as } n\\to\\infty$$",
];

const SENTENCES = [
  "The definition extends to any random variable with a finite second moment",
  "Linearity holds whether or not the variables are independent",
  "We will use this identity repeatedly in the next lecture",
  "Try a small example with two dice before reading the proof",
  "The sample estimate converges to the population value",
];

function slide(n: number): string {
  const topic = TOPICS[n % TOPICS.length];
  const lines: string[] = [];
  lines.push(`::: {.slide #s${n} n=${n} src="A${n}" title="${topic} ${n}"}`);
  lines.push(`## ${topic} ${n}`, "");
  const blocks = 3 + (n % 3);
  for (let b = 1; b <= blocks; b++) {
    const text = SENTENCES[(n + b) % SENTENCES.length];
    const math = b % 2 === 1 ? ` ${INLINE[(n + b) % INLINE.length]}` : "";
    const flag = (n + b) % 11 === 0 ? " .flag" : "";
    lines.push(`[${text}${math}]{#s${n}b${b}${flag}}`, "");
  }
  lines.push(DISPLAY[n % DISPLAY.length], "");
  if (n % 2 === 0) {
    const g = (n * 7919).toString(16).slice(-4);
    lines.push(`::: {.gloss #g-${g} kind=steps key=s anchor=s${n}b1 model="fake" by=ai vote=+1 variant=1/1}`);
    lines.push(`**you asked:** how does ${topic.toLowerCase()} follow here?`, "");
    lines.push(`1. Start from ${INLINE[n % INLINE.length]}.`);
    lines.push("2. Expand the square and collect the cross terms.");
    lines.push(`3. Conclude with ${INLINE[(n + 2) % INLINE.length]}.`);
    lines.push(":::", "");
  }
  if (n % 5 === 0) {
    lines.push(`::: {.note #n-${n.toString(16).padStart(4, "0")} anchor=s${n}b2}`);
    lines.push("Check this against the worked example in the textbook.");
    lines.push(":::", "");
  }
  lines.push(":::", "");
  return lines.join("\n");
}

export function fixtureLecture(slides: number): string {
  const head = [
    "---",
    "lecter: 1",
    "lecture: 7",
    "date: 2026-10-23",
    "title: Synthetic Fixture",
    "slides:",
    "  - slides/07-fixture.pdf",
    "---",
    "",
  ].join("\n");
  const body: string[] = [];
  for (let n = 1; n <= slides; n++) body.push(slide(n));
  return head + body.join("\n");
}
