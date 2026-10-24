# lecter-cas

Converts LaTeX to an expression and runs numeric equivalence checks for the `s` (steps) gloss.
Spec: `06-ai-harness.md#steps-checking-s`.

## Invariants

- Pure Rust, no network, no allocation storms: a check finishes in < 5 ms per step pair.
- Check by numeric sampling. Use random points in the domain, several seeds, and tolerance by relative error. An expression that can't be parsed gives "unchecked", never "wrong".
- Symbolic CAS is v1 (`15-later.md`). Don't build it.
- Property tests: equivalent rewrites must pass, and known non-equivalences must fail.

## Learned

