//! One file through the parse worker: spawn, `Hello`, `Parse`, `Progress`*, `Done` or `Failed`.

use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use lecter_parse::proto::{self, Codec, FromWorker, PROTO_VERSION, ToWorker};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::{Block, Crop, Figure, Limits, WorkerCommand};
use crate::error::{Error, Result};

/// How long a worker that already answered (or broke the protocol) gets to exit before it is killed.
const EXIT_GRACE: Duration = Duration::from_secs(1);

/// What the worker read from one file.
#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    /// Every block, in reading order.
    pub blocks: Vec<Block>,
    /// Image crops of regions the text layer couldn't read.
    pub crops: Vec<Crop>,
    /// Figures found on the pages.
    pub figures: Vec<Figure>,
}

/// How an exchange with the worker ended without a result.
enum Broke {
    /// The worker answered `Failed`: its reason is for the user as it stands.
    Failed(String),
    /// The worker broke the protocol or the pipe closed: the reason describes it.
    Protocol(String),
}

/// Parses the file at `path` (absolute) in a fresh worker started by `cmd`, calling
/// `progress(page, pages)` for each page. The worker is killed after `timeout`, and on any crash
/// or protocol error, and the file fails with [`Error::ParseFailed`] (`E_PARSE_FAILED`). Dropping
/// the returned future kills the worker too.
pub async fn parse_file(
    cmd: &WorkerCommand,
    path: &Path,
    limits: Limits,
    timeout: Duration,
    mut progress: impl FnMut(u32, u32),
) -> Result<Parsed> {
    if !path.is_absolute() {
        return Err(Error::NotAbsolute);
    }
    let path = path.to_str().ok_or(Error::NotUnicode)?.to_owned();
    let mut child = Command::new(&cmd.program)
        .args(&cmd.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The worker's own diagnostics go to the core's stderr; nothing parses them.
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| Error::ParseFailed(format!("The parse worker could not be started: {e}.")))?;
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err(Error::ParseFailed("The parse worker's pipes could not be opened.".into()));
    };
    let talk = exchange(stdin, stdout, cmd.codec, ToWorker::Parse { path, limits }, &mut progress);
    match tokio::time::timeout(timeout, talk).await {
        Ok(Ok(parsed)) => {
            finish(&mut child).await;
            Ok(parsed)
        }
        Ok(Err(Broke::Failed(reason))) => {
            finish(&mut child).await;
            Err(Error::ParseFailed(reason))
        }
        Ok(Err(Broke::Protocol(reason))) => {
            let status = finish(&mut child).await;
            Err(Error::ParseFailed(format!("The parse worker stopped unexpectedly ({reason}; {}).", describe(status))))
        }
        Err(_elapsed) => {
            stop(&mut child).await;
            Err(Error::ParseFailed(format!(
                "Parsing took longer than {} s, so the parse worker was stopped.",
                timeout.as_secs_f32()
            )))
        }
    }
}

/// The whole conversation, up to the worker's last frame.
async fn exchange(
    mut stdin: ChildStdin,
    mut stdout: ChildStdout,
    codec: Codec,
    parse: ToWorker,
    progress: &mut impl FnMut(u32, u32),
) -> std::result::Result<Parsed, Broke> {
    send(&mut stdin, codec, &ToWorker::Hello { proto_version: PROTO_VERSION }).await?;
    match recv(&mut stdout, codec).await? {
        FromWorker::Hello { proto_version } if proto_version == PROTO_VERSION => {}
        FromWorker::Hello { proto_version } => {
            return Err(Broke::Protocol(format!(
                "protocol version mismatch: worker {proto_version}, core {PROTO_VERSION}"
            )));
        }
        _ => return Err(Broke::Protocol("its first frame was not Hello".into())),
    }
    send(&mut stdin, codec, &parse).await?;
    drop(stdin);
    loop {
        match recv(&mut stdout, codec).await? {
            FromWorker::Progress { page, pages } => progress(page, pages),
            FromWorker::Done { blocks, crops, figures } => return Ok(Parsed { blocks, crops, figures }),
            FromWorker::Failed { reason, .. } => return Err(Broke::Failed(reason)),
            FromWorker::Hello { .. } => return Err(Broke::Protocol("it said Hello twice".into())),
        }
    }
}

async fn send(stdin: &mut ChildStdin, codec: Codec, msg: &ToWorker) -> std::result::Result<(), Broke> {
    let frame = codec.encode(msg).map_err(|e| Broke::Protocol(e.to_string()))?;
    stdin.write_all(&frame).await.map_err(|e| Broke::Protocol(format!("its input closed: {e}")))?;
    stdin.flush().await.map_err(|e| Broke::Protocol(format!("its input closed: {e}")))
}

async fn recv(stdout: &mut ChildStdout, codec: Codec) -> std::result::Result<FromWorker, Broke> {
    let mut prefix = [0u8; 4];
    stdout.read_exact(&mut prefix).await.map_err(|_| Broke::Protocol("its output ended".into()))?;
    let len = proto::body_len(prefix).map_err(|e| Broke::Protocol(e.to_string()))?;
    let mut body = vec![0u8; len];
    stdout.read_exact(&mut body).await.map_err(|_| Broke::Protocol("its output ended mid-frame".into()))?;
    codec.decode(&body).map_err(|e| Broke::Protocol(e.to_string()))
}

/// Waits briefly for a worker that is done to exit, then kills it. Returns how it ended.
async fn finish(child: &mut Child) -> Option<ExitStatus> {
    match tokio::time::timeout(EXIT_GRACE, child.wait()).await {
        Ok(Ok(status)) => Some(status),
        _ => {
            stop(child).await;
            None
        }
    }
}

/// Kills the worker and reaps it.
async fn stop(child: &mut Child) {
    // An error means it already exited; either way nothing is left running.
    let _ = child.kill().await;
}

fn describe(status: Option<ExitStatus>) -> String {
    match status {
        Some(s) if s.success() => "it exited without an error".into(),
        Some(s) => match s.code() {
            Some(code) => format!("exit code {code}"),
            None => "it crashed".into(),
        },
        None => "it was killed".into(),
    }
}
