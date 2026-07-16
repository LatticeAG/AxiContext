pub fn hello() -> &'static str {
    "hello from minimal-rust-repo"
}

#[cfg(test)]
mod tests {
    use super::hello;

    #[test]
    fn returns_fixture_message() {
        assert_eq!(hello(), "hello from minimal-rust-repo");
    }
}
