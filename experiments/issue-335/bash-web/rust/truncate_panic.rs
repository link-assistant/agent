// Mirrors rust/src/tool/bash.rs:125-127 (String::truncate at a byte index).
// rustc truncate_panic.rs && ./truncate_panic
const MAX_OUTPUT_LENGTH: usize = 30_000;
fn main() {
    // 29_999 ASCII bytes followed by a 3-byte char straddling byte 30_000
    let mut output = "x".repeat(29_999) + "€€€";
    if output.len() > MAX_OUTPUT_LENGTH {
        output.truncate(MAX_OUTPUT_LENGTH);
    }
    println!("len {}", output.len());
}
