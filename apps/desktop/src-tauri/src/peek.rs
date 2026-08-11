//! Reading the lines a citation points at.
//!
//! A chip in the transcript says `AGENTS.md (line 7)`, and this reads enough of
//! the file around line 7 to check the claim without leaving the app.
//!
//! Only the window is ever wanted, so the file is streamed rather than read
//! whole: a generated file in a real workspace can be tens of megabytes, and
//! pulling all of it across the IPC boundary to show seven lines would be
//! absurd. Everything else here is about files that are not what a reader
//! expects — binary, enormous, or deleted since the agent mentioned them.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use serde::Serialize;

/// A minified bundle is one line and megabytes long. Nothing useful is read
/// past this, and the truncation is visible in the result.
const MAX_LINE: usize = 2_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWindow {
    /// The line number of `lines[0]`, 1-based.
    pub start_line: u32,
    pub lines: Vec<String>,
    /// Lines in the whole file, so the reader knows where the window sits.
    pub total_lines: u32,
    /// The cited line, when the file actually has one. `None` when the
    /// citation named no line, or named one past the end — a stale citation
    /// should not highlight an unrelated line as though it were the claim.
    pub focus_line: Option<u32>,
    pub path: String,
}

/// True if the first few kilobytes contain a NUL byte.
///
/// Crude, and deliberately so: it is the same heuristic `grep` uses, it costs
/// one small read, and the cost of a false negative is a screen of mojibake
/// rather than anything unsafe.
fn looks_binary(path: &Path) -> Result<bool, String> {
    let mut head = [0u8; 8_000];
    let mut file = File::open(path).map_err(|error| describe(path, error))?;
    let read = file
        .read(&mut head)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    Ok(head[..read].contains(&0))
}

fn describe(path: &Path, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        return format!("Could not find {name}. It may have been moved or deleted.");
    }
    format!("Could not read {}: {error}", path.display())
}

pub fn read_window(
    workspace: &Path,
    relative: &str,
    line: Option<u32>,
    radius: u32,
) -> Result<FileWindow, String> {
    let vetted = crate::paths::vetted(relative)?;
    let path = workspace.join(&vetted);

    if looks_binary(&path)? {
        return Err(format!("{vetted} looks like a binary file."));
    }

    // Two passes rather than buffering the file: the first counts, the second
    // collects only the window. Both are streamed, so memory stays flat
    // whatever the file size.
    let total_lines = count_lines(&path)?;
    if total_lines == 0 {
        return Ok(FileWindow {
            start_line: 1,
            lines: Vec::new(),
            total_lines: 0,
            focus_line: None,
            path: vetted,
        });
    }

    // A citation past the end is stale. Show the tail so there is something to
    // orient by, but do not claim a line is the one that was cited.
    let cited = line.filter(|n| *n >= 1 && *n <= total_lines);
    let anchor = cited.unwrap_or_else(|| line.map_or(1, |_| total_lines));

    let start_line = anchor.saturating_sub(radius).max(1);
    let end_line = anchor.saturating_add(radius).min(total_lines);

    let file = File::open(&path).map_err(|error| describe(&path, error))?;
    let lines: Vec<String> = BufReader::new(file)
        .lines()
        .skip(start_line as usize - 1)
        .take((end_line - start_line + 1) as usize)
        .map(|line| match line {
            Ok(text) => truncate(text),
            // A line that is not UTF-8 in an otherwise text file: show the
            // problem on that line rather than failing the whole window.
            Err(_) => "… line could not be decoded".to_string(),
        })
        .collect();

    Ok(FileWindow {
        start_line,
        lines,
        total_lines,
        focus_line: cited,
        path: vetted,
    })
}

fn truncate(mut text: String) -> String {
    if text.len() <= MAX_LINE {
        return text;
    }
    // Cut on a character boundary; a byte index into UTF-8 would panic.
    let mut cut = MAX_LINE;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    text.truncate(cut);
    text.push('…');
    text
}

fn count_lines(path: &Path) -> Result<u32, String> {
    let file = File::open(path).map_err(|error| describe(path, error))?;
    let mut count: u32 = 0;
    for line in BufReader::new(file).lines() {
        line.map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        count = count.saturating_add(1);
    }
    Ok(count)
}
