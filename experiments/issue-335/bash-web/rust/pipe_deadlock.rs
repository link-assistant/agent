// Mirrors rust/src/tool/bash.rs:176-197: read all of stdout, THEN all of stderr.
// A child that writes >64 KiB to stderr before closing stdout blocks forever.
// rustc pipe_deadlock.rs && timeout 5 ./pipe_deadlock; echo exit=$?
use std::io::Read;
use std::process::{Command, Stdio};
fn main() {
    let mut child = Command::new("bash").arg("-c")
        .arg("head -c 200000 /dev/zero >&2; echo done")
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let (mut out, mut err) = (String::new(), String::new());
    child.stdout.as_mut().unwrap().read_to_string(&mut out).unwrap();
    child.stderr.as_mut().unwrap().read_to_string(&mut err).unwrap();
    println!("finished: stdout={:?} stderr_len={}", out, err.len());
}
