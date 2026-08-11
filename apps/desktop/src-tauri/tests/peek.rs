//! Resolving a citation to the file it names.
//!
//! A chip in the transcript says `AGENTS.md (line 7)`; this reads the lines
//! around line 7 so the claim can be checked without leaving the app.
//!
//! The path comes from a model's prose, so it is vetted the same way a patch
//! path is. The rest of the care here is about files that are not what a reader
//! expects: something enormous, something binary, something that has been
//! deleted since the agent mentioned it.

use artemis_host::peek;
use std::path::PathBuf;

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("artemis-peek-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn numbered(count: usize) -> String {
    (1..=count)
        .map(|n| format!("line {n}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn reads_a_window_around_the_cited_line() {
    let dir = workspace("window");
    std::fs::write(dir.join("seed.txt"), numbered(40)).unwrap();

    let window = peek::read_window(&dir, "seed.txt", Some(20), 3).expect("window");

    assert_eq!(window.start_line, 17);
    assert_eq!(window.focus_line, Some(20));
    assert_eq!(
        window.lines,
        vec!["line 17", "line 18", "line 19", "line 20", "line 21", "line 22", "line 23"]
    );
    assert_eq!(window.total_lines, 40, "so the reader knows where they are");
}

#[test]
fn clamps_at_the_top_of_the_file() {
    let dir = workspace("clamp_top");
    std::fs::write(dir.join("seed.txt"), numbered(10)).unwrap();

    let window = peek::read_window(&dir, "seed.txt", Some(2), 5).expect("window");
    assert_eq!(window.start_line, 1, "there is no line zero");
    assert_eq!(window.lines.first().unwrap(), "line 1");
    assert_eq!(window.focus_line, Some(2));
}

#[test]
fn clamps_at_the_end_of_the_file() {
    let dir = workspace("clamp_end");
    std::fs::write(dir.join("seed.txt"), numbered(10)).unwrap();

    let window = peek::read_window(&dir, "seed.txt", Some(9), 5).expect("window");
    assert_eq!(window.lines.last().unwrap(), "line 10");
    assert_eq!(window.start_line + window.lines.len() as u32 - 1, 10);
}

/// A citation with no line number is still worth opening — it just starts at
/// the top rather than nowhere.
#[test]
fn a_citation_without_a_line_opens_the_top() {
    let dir = workspace("no_line");
    std::fs::write(dir.join("seed.txt"), numbered(40)).unwrap();

    let window = peek::read_window(&dir, "seed.txt", None, 3).expect("window");
    assert_eq!(window.start_line, 1);
    assert_eq!(window.focus_line, None, "nothing to highlight");
    assert!(!window.lines.is_empty());
}

/// A line past the end is a stale citation, not a crash: the agent may have
/// named a line that a later edit removed.
#[test]
fn a_line_past_the_end_lands_on_the_last_one() {
    let dir = workspace("past_end");
    std::fs::write(dir.join("seed.txt"), numbered(5)).unwrap();

    let window = peek::read_window(&dir, "seed.txt", Some(900), 2).expect("window");
    assert_eq!(window.lines.last().unwrap(), "line 5");
    assert_eq!(
        window.focus_line, None,
        "there is no such line, so nothing should be highlighted as if there were"
    );
}

#[test]
fn refuses_a_path_that_leaves_the_workspace() {
    let dir = workspace("escape");
    std::fs::write(dir.join("seed.txt"), "x").unwrap();

    for escape in ["../secrets.txt", "/etc/passwd", "a/../../x"] {
        let error = peek::read_window(&dir, escape, Some(1), 3)
            .expect_err(&format!("{escape} should be refused"));
        assert!(
            error.to_lowercase().contains("path") || error.to_lowercase().contains("outside"),
            "{escape} refused for the wrong reason: {error}"
        );
    }
}

#[test]
fn a_file_that_is_gone_says_so() {
    let dir = workspace("missing");
    let error = peek::read_window(&dir, "nope.txt", Some(1), 3).expect_err("missing");
    assert!(
        error.to_lowercase().contains("not") || error.to_lowercase().contains("find"),
        "unhelpful message: {error}"
    );
}

/// Rendering a binary as text produces a screen of mojibake and can be very
/// large. Refusing is more useful than showing it.
#[test]
fn refuses_a_binary_file() {
    let dir = workspace("binary");
    std::fs::write(dir.join("blob.bin"), [0x00, 0x01, 0x02, 0xff, 0x00]).unwrap();

    let error = peek::read_window(&dir, "blob.bin", Some(1), 3).expect_err("binary");
    assert!(error.to_lowercase().contains("binary"), "{error}");
}

/// A generated file can be tens of megabytes. Only the window is ever needed,
/// so the whole thing must not be pulled into memory to get it.
#[test]
fn a_very_long_file_still_returns_only_the_window() {
    let dir = workspace("huge");
    std::fs::write(dir.join("big.txt"), numbered(200_000)).unwrap();

    let window = peek::read_window(&dir, "big.txt", Some(150_000), 2).expect("window");
    assert_eq!(window.lines.len(), 5);
    assert_eq!(window.lines[2], "line 150000");
    assert_eq!(window.total_lines, 200_000);
}

/// One enormous line — a minified bundle, say — should not arrive whole.
#[test]
fn a_single_enormous_line_is_truncated() {
    let dir = workspace("long_line");
    std::fs::write(dir.join("bundle.js"), "x".repeat(50_000)).unwrap();

    let window = peek::read_window(&dir, "bundle.js", Some(1), 3).expect("window");
    assert!(
        window.lines[0].len() < 5_000,
        "got {} characters",
        window.lines[0].len()
    );
}

#[test]
fn an_empty_file_is_not_an_error() {
    let dir = workspace("empty");
    std::fs::write(dir.join("empty.txt"), "").unwrap();

    let window = peek::read_window(&dir, "empty.txt", Some(1), 3).expect("window");
    assert_eq!(window.total_lines, 0);
    assert!(window.lines.is_empty());
    assert_eq!(window.focus_line, None);
}
