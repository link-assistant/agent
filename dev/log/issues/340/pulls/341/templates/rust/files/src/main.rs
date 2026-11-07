use lino_arguments::Parser;
use std::io::{self, Write};

use example_sum_package_name::sum;

#[derive(Parser, Debug)]
#[command(name = "example-sum-package-name", about = "Sum two numbers")]
struct Args {
    #[arg(long, env = "A", default_value = "0", allow_hyphen_values = true)]
    a: i64,

    #[arg(long, env = "B", default_value = "0", allow_hyphen_values = true)]
    b: i64,
}

fn write_output(writer: &mut impl Write, output: &str) -> io::Result<()> {
    match writer
        .write_all(output.as_bytes())
        .and_then(|()| writer.flush())
    {
        Err(e) if e.kind() == io::ErrorKind::BrokenPipe => Ok(()),
        result => result,
    }
}

fn write_stdout(output: &str) -> io::Result<()> {
    write_output(&mut io::stdout(), output)
}

fn main() -> io::Result<()> {
    let args = Args::parse();
    write_stdout(&format!("{}\n", sum(args.a, args.b)))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct BrokenPipeWriter;

    impl Write for BrokenPipeWriter {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::BrokenPipe))
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct OtherErrorWriter;

    impl Write for OtherErrorWriter {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn write_output_treats_broken_pipe_as_clean_exit() {
        assert!(write_output(&mut BrokenPipeWriter, "1\n").is_ok());
    }

    #[test]
    fn write_output_preserves_other_io_errors() {
        let err = write_output(&mut OtherErrorWriter, "1\n").unwrap_err();

        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
    }
}
