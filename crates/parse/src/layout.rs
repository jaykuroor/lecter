//! Reading order from text-layer positions (`04-parsing.md#reading-ladder`, step 2).
//!
//! The text layer gives runs of text with their boxes, in the order the file drew them, which is not
//! the order a person reads. Runs on one baseline become a line; a line joins the block whose last
//! line sits just above it (similar size, overlapping horizontally), otherwise it starts a new
//! block. Blocks are numbered in the order they start: top to bottom, then left to right. Headings,
//! lists and columns get their own rules with the full text-layer reader (F-057).

use crate::proto::{BBox, Block, BlockKind, Method};

/// A run of text on a page as the text layer reports it, in PDF points with y going up.
#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    /// The run's characters.
    pub text: String,
    /// Left edge.
    pub left: f32,
    /// Bottom edge.
    pub bottom: f32,
    /// Right edge.
    pub right: f32,
    /// Top edge.
    pub top: f32,
}

impl Run {
    fn height(&self) -> f32 {
        self.top - self.bottom
    }
}

/// Two runs share a line when they overlap vertically by at least this share of the shorter one.
const SAME_LINE_OVERLAP: f32 = 0.5;
/// …and the horizontal gap between them is at most this many line heights (wider gaps are columns).
const SAME_LINE_MAX_GAP: f32 = 3.0;
/// A gap wider than this many line heights between two runs of a line is a space.
const WORD_GAP: f32 = 0.125;
/// A line continues a block when the gap above it is at most this many line heights…
const SAME_BLOCK_MAX_GAP: f32 = 0.5;
/// …and the taller of the two lines is at most this many times the shorter (else it's a heading).
const SAME_BLOCK_MAX_SIZE_RATIO: f32 = 1.25;

/// The blocks of page `page` (1-based, `page_height` points tall) from its text runs.
pub fn blocks(page: u32, page_height: f32, runs: Vec<Run>) -> Vec<Block> {
    let mut runs: Vec<Run> = runs
        .into_iter()
        .filter(|r| !r.text.trim().is_empty())
        .filter(|r| [r.left, r.bottom, r.right, r.top].iter().all(|v| v.is_finite()))
        .filter(|r| r.right >= r.left && r.top > r.bottom)
        .collect();
    runs.sort_by(|a, b| b.top.total_cmp(&a.top).then(a.left.total_cmp(&b.left)));

    let mut lines: Vec<Vec<Run>> = Vec::new();
    for run in runs {
        match lines.iter_mut().rev().find(|l| same_line(l, &run)) {
            Some(line) => line.push(run),
            None => lines.push(vec![run]),
        }
    }
    let mut lines: Vec<Run> = lines.into_iter().map(join_line).collect();
    lines.sort_by(|a, b| b.top.total_cmp(&a.top).then(a.left.total_cmp(&b.left)));

    let mut groups: Vec<Vec<Run>> = Vec::new();
    for line in lines {
        match groups.iter_mut().rev().find(|g| continues(g, &line)) {
            Some(g) => g.push(line),
            None => groups.push(vec![line]),
        }
    }
    groups.into_iter().enumerate().map(|(i, g)| block(page, i + 1, page_height, &g)).collect()
}

/// Does `run` sit on the same baseline as `line`, close enough to be part of it?
fn same_line(line: &[Run], run: &Run) -> bool {
    line.iter().any(|r| {
        let overlap = r.top.min(run.top) - r.bottom.max(run.bottom);
        let h = r.height().min(run.height());
        let gap = (run.left - r.right).max(r.left - run.right);
        overlap >= SAME_LINE_OVERLAP * h && gap <= SAME_LINE_MAX_GAP * r.height().max(run.height())
    })
}

/// The runs of one line, left to right, as one run.
fn join_line(mut runs: Vec<Run>) -> Run {
    runs.sort_by(|a, b| a.left.total_cmp(&b.left));
    let mut out = runs[0].clone();
    for r in &runs[1..] {
        let gap = r.left - out.right;
        let spaced = out.text.ends_with(char::is_whitespace) || r.text.starts_with(char::is_whitespace);
        if gap > WORD_GAP * out.height().max(r.height()) && !spaced {
            out.text.push(' ');
        }
        out.text.push_str(&r.text);
        out.left = out.left.min(r.left);
        out.right = out.right.max(r.right);
        out.bottom = out.bottom.min(r.bottom);
        out.top = out.top.max(r.top);
    }
    out.text = out.text.trim().to_owned();
    out
}

/// Does `line` continue the block whose lines are `group`?
fn continues(group: &[Run], line: &Run) -> bool {
    let Some(last) = group.last() else { return false };
    let (big, small) = (last.height().max(line.height()), last.height().min(line.height()));
    let gap = last.bottom - line.top;
    let overlaps = line.left < last.right && last.left < line.right;
    gap <= SAME_BLOCK_MAX_GAP * big && big <= SAME_BLOCK_MAX_SIZE_RATIO * small && overlaps && line.top < last.top
}

/// The block numbered `n` on `page` from its lines.
fn block(page: u32, n: usize, page_height: f32, lines: &[Run]) -> Block {
    let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    let left = lines.iter().map(|l| l.left).fold(f32::INFINITY, f32::min);
    let right = lines.iter().map(|l| l.right).fold(f32::NEG_INFINITY, f32::max);
    let top = lines.iter().map(|l| l.top).fold(f32::NEG_INFINITY, f32::max);
    let bottom = lines.iter().map(|l| l.bottom).fold(f32::INFINITY, f32::min);
    Block {
        id: format!("s{page}b{n}"),
        page,
        kind: BlockKind::Paragraph,
        text,
        bbox: BBox { x: left, y: page_height - top, w: right - left, h: top - bottom },
        method: Method::TextLayer,
        confidence: 1.0,
    }
}

#[cfg(test)]
#[path = "layout_tests.rs"]
mod tests;
