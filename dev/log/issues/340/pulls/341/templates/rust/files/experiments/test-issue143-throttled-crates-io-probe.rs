#!/usr/bin/env rust-script
//! Reproduction for issue #143: a throttled crates.io probe was reported as
//! "the version was never published".
//!
//! The script serves a local stand-in for crates.io that answers **429** to
//! every request — the same shape as the real 403 that crates.io returns to a
//! client without a `User-Agent`, or the 429 it returns under rate limiting —
//! and runs both classifications against it:
//!
//! - the old `-> bool` probe from `scripts/wait-for-crate.rs`, which collapses
//!   every failure into `false`, i.e. "not published yet"
//! - the `Visibility` classification that replaced it, which reports `Unknown`
//!
//! Run with: rust-script experiments/test-issue143-throttled-crates-io-probe.rs
//!
//! ```cargo
//! [dependencies]
//! ureq = "2"
//! ```

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// The behaviour before the fix, copied verbatim from `wait-for-crate.rs`.
fn crate_version_exists_old(url: &str) -> bool {
    match ureq::get(url)
        .set("User-Agent", "rust-script-wait-for-crate")
        .call()
    {
        Ok(response) => response.status() == 200,
        Err(ureq::Error::Status(404, _)) => false,
        Err(e) => {
            eprintln!("Warning: Could not check crates.io: {}", e);
            false
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Visibility {
    Published,
    NotPublishedYet,
    Unknown(String),
}

/// The behaviour after the fix.
fn crate_version_visibility_new(url: &str) -> Visibility {
    let classify = |status: u16| match status {
        200 => Visibility::Published,
        404 => Visibility::NotPublishedYet,
        other => Visibility::Unknown(format!("crates.io API responded HTTP {}", other)),
    };

    match ureq::get(url)
        .set("User-Agent", "rust-script-wait-for-crate")
        .call()
    {
        Ok(response) => classify(response.status()),
        Err(ureq::Error::Status(status, _)) => classify(status),
        Err(e) => Visibility::Unknown(format!("crates.io API request failed: {}", e)),
    }
}

fn serve_429(mut stream: TcpStream) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
    let mut line = String::new();
    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        if line == "\r\n" || line == "\n" {
            break;
        }
        line.clear();
    }
    let _ = stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n");
    let _ = stream.flush();
}

fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind stand-in server");
    let url = format!(
        "http://{}/api/v1/crates/anything/1.0.0",
        listener.local_addr().expect("local addr")
    );

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            serve_429(stream);
        }
    });

    println!("crates.io stand-in under rate limiting: {url}\n");

    let old = crate_version_exists_old(&url);
    println!("before the fix: crate_version_exists(..) -> {old}");
    println!(
        "  the caller reads this as \"not published yet\", exhausts every attempt, \
         and fails the release\n"
    );

    let new = crate_version_visibility_new(&url);
    println!("after the fix:  crate_version_visibility(..) -> {new:?}");
    println!("  the caller reports that crates.io could not be consulted\n");

    assert!(!old, "the old probe collapsed HTTP 429 into 'not published'");
    assert!(
        matches!(new, Visibility::Unknown(_)),
        "HTTP 429 must be reported as unknown, not as a missing version"
    );
    println!("OK: the regression reproduces, and the new classification avoids it.");
}
