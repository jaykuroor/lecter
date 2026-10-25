use super::*;

fn run(text: &str, left: f32, bottom: f32, right: f32, top: f32) -> Run {
    Run { text: text.into(), left, bottom, right, top }
}

fn texts(blocks: &[Block]) -> Vec<(&str, &str)> {
    blocks.iter().map(|b| (b.id.as_str(), b.text.as_str())).collect()
}

#[test]
fn blocks_follow_reading_order_not_drawing_order() {
    // Drawn bottom paragraph first, then the second line before the first, then the title.
    let runs = vec![
        run("Heat flows from hot to cold.", 72.0, 580.0, 400.0, 596.0),
        run("entropy never falls.", 72.0, 660.0, 300.0, 676.0),
        run("The second law says", 72.0, 680.0, 320.0, 696.0),
        run("Entropy and heat", 72.0, 730.0, 400.0, 762.0),
    ];
    let b = blocks(3, 792.0, runs);
    assert_eq!(
        texts(&b),
        [
            ("s3b1", "Entropy and heat"),
            ("s3b2", "The second law says\nentropy never falls."),
            ("s3b3", "Heat flows from hot to cold."),
        ]
    );
    assert!(b.iter().all(|b| b.page == 3 && b.kind == BlockKind::Paragraph));
    assert!(b.iter().all(|b| b.method == Method::TextLayer && b.confidence == 1.0));
}

#[test]
fn bbox_is_the_union_of_the_lines_measured_from_the_top_left() {
    let runs = vec![run("one", 72.0, 680.0, 320.0, 696.0), run("two", 80.0, 660.0, 350.0, 676.0)];
    let b = blocks(1, 792.0, runs);
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].bbox, BBox { x: 72.0, y: 96.0, w: 278.0, h: 36.0 });
}

#[test]
fn runs_on_one_baseline_join_left_to_right_with_spaces_only_at_gaps() {
    let runs = vec![
        run("law", 202.0, 700.0, 232.0, 716.0),
        run("Sec", 72.0, 700.0, 100.0, 716.0),
        run("ond", 100.0, 700.0, 130.0, 716.0),  // touching: same word
        run(" of", 134.0, 700.0, 160.0, 716.0),  // gap, but the run starts with a space
        run("heat", 162.0, 699.0, 198.0, 715.0), // gap 2 = exactly 0.125 × 16: no space
    ];
    let b = blocks(1, 792.0, runs);
    assert_eq!(texts(&b), [("s1b1", "Second ofheat law")]);
}

#[test]
fn a_size_jump_starts_a_new_block_even_when_close() {
    // 16 pt body under a 20 pt line (ratio 1.25 continues) and a 20.5 pt one (ratio over 1.25 splits).
    let same = blocks(1, 792.0, vec![run("big", 72.0, 700.0, 300.0, 720.0), run("small", 72.0, 680.0, 300.0, 696.0)]);
    assert_eq!(same.len(), 1, "{:?}", texts(&same));
    let split = blocks(1, 792.0, vec![run("big", 72.0, 700.0, 300.0, 720.5), run("small", 72.0, 680.0, 300.0, 696.0)]);
    assert_eq!(texts(&split), [("s1b1", "big"), ("s1b2", "small")]);
}

#[test]
fn a_gap_of_half_a_line_continues_a_block_and_more_splits_it() {
    let at = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 300.0, 716.0), run("b", 72.0, 676.0, 300.0, 692.0)]);
    assert_eq!(texts(&at), [("s1b1", "a\nb")]);
    let over = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 300.0, 716.0), run("b", 72.0, 675.5, 300.0, 691.5)]);
    assert_eq!(texts(&over), [("s1b1", "a"), ("s1b2", "b")]);
}

#[test]
fn side_by_side_columns_stay_apart_left_first() {
    let runs = vec![
        run("right one", 400.0, 700.0, 540.0, 716.0),
        run("left two", 72.0, 680.0, 250.0, 696.0),
        run("right two", 400.0, 680.0, 540.0, 696.0),
        run("left one", 72.0, 700.0, 250.0, 716.0),
    ];
    let b = blocks(1, 792.0, runs);
    assert_eq!(texts(&b), [("s1b1", "left one\nleft two"), ("s1b2", "right one\nright two")]);
}

#[test]
fn a_gap_of_three_heights_is_still_one_line_and_more_is_two() {
    let one = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 100.0, 716.0), run("b", 148.0, 700.0, 170.0, 716.0)]);
    assert_eq!(texts(&one), [("s1b1", "a b")]);
    let two = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 100.0, 716.0), run("b", 148.5, 700.0, 170.0, 716.0)]);
    assert_eq!(texts(&two), [("s1b1", "a"), ("s1b2", "b")]);
    // The same with the right-hand run half a point higher, so it is seen first.
    let one = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 100.0, 716.0), run("b", 148.0, 700.5, 170.0, 716.5)]);
    assert_eq!(texts(&one), [("s1b1", "a b")]);
    let two = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 100.0, 716.0), run("b", 148.5, 700.5, 170.0, 716.5)]);
    assert_eq!(texts(&two), [("s1b1", "b"), ("s1b2", "a")]);
}

#[test]
fn half_a_height_of_vertical_overlap_is_one_line_and_less_is_two() {
    // Second run 8 pt lower: overlaps 8 of 16 pt (one line). 8.5 pt lower: two lines.
    let one = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 100.0, 716.0), run("b", 104.0, 692.0, 130.0, 708.0)]);
    assert_eq!(texts(&one), [("s1b1", "a b")]);
    let two = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 100.0, 716.0), run("b", 104.0, 691.5, 130.0, 707.5)]);
    assert_eq!(two.len(), 2, "{:?}", texts(&two));
}

#[test]
fn lines_that_do_not_overlap_horizontally_are_separate_blocks() {
    let b = blocks(1, 792.0, vec![run("a", 72.0, 700.0, 200.0, 716.0), run("b", 200.0, 680.0, 300.0, 696.0)]);
    assert_eq!(texts(&b), [("s1b1", "a"), ("s1b2", "b")]);
    let b = blocks(1, 792.0, vec![run("a", 200.0, 700.0, 300.0, 716.0), run("b", 72.0, 680.0, 200.0, 696.0)]);
    assert_eq!(texts(&b), [("s1b1", "a"), ("s1b2", "b")]);
}

#[test]
fn blank_and_degenerate_runs_are_dropped() {
    let runs = vec![
        run("   ", 72.0, 700.0, 100.0, 716.0),
        run("nan", f32::NAN, 700.0, 100.0, 716.0),
        run("inf", 72.0, 700.0, f32::INFINITY, 716.0),
        run("flat", 72.0, 700.0, 100.0, 700.0),
        run("backwards", 100.0, 700.0, 72.0, 716.0),
        run(" kept ", 72.0, 600.0, 100.0, 616.0),
    ];
    assert_eq!(texts(&blocks(1, 792.0, runs)), [("s1b1", "kept")]);
    assert!(blocks(1, 792.0, vec![]).is_empty());
}
