//! `lecter`: the command-line tool. In v0 it prints its version and nothing else;
//! the commands (`export`, `doubts`, `ask`) arrive in v1 (`docs/spec/15-later.md`).

/// The line the binary prints: the program name and its version.
fn version_line() -> String {
    format!("lecter {}", env!("CARGO_PKG_VERSION"))
}

fn main() {
    println!("{}", version_line());
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_line_names_the_program_and_its_package_version() {
        assert_eq!(super::version_line(), concat!("lecter ", env!("CARGO_PKG_VERSION")));
    }
}
