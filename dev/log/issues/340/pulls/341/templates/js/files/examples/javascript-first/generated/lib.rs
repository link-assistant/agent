// Generated from native.mjs sha256:305969e87d5b471e2245a5cc16abcfc8a1186bd745acfa4c91f6c65a03b51536
pub fn is_even(value: i32) -> bool { value % 2 == 0 }

#[test]
fn shared_observations() {
    assert_eq!(is_even(0), true);
    assert_eq!(is_even(1), false);
    assert_eq!(is_even(-1), false);
    assert_eq!(is_even(2), true);
    assert_eq!(is_even(-2), true);
    assert_eq!(is_even(-2147483648), true);
    assert_eq!(is_even(2147483647), false);
}
