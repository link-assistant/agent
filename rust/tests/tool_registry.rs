//! Tests for ToolRegistry.
//!
//! Extracted from the original inline tests in rust/src/tool/mod.rs.

use link_assistant_agent::tool::ToolRegistry;

#[test]
fn test_registry_creation() {
    let registry = ToolRegistry::new();
    assert!(!registry.all().is_empty());
}

#[test]
fn test_tool_lookup() {
    let registry = ToolRegistry::new();
    assert!(registry.get("read").is_some());
    assert!(registry.get("write").is_some());
    assert!(registry.get("edit").is_some());
    assert!(registry.get("bash").is_some());
    assert!(registry.get("glob").is_some());
    assert!(registry.get("grep").is_some());
    assert!(registry.get("list").is_some());
    assert!(registry.get("webfetch").is_some());
    assert!(registry.get("websearch").is_some());
    assert!(registry.get("codesearch").is_some());
    assert!(registry.get("batch").is_some());
    assert!(registry.get("todowrite").is_some());
    assert!(registry.get("todoread").is_some());
    assert!(registry.get("multiedit").is_some());
    assert!(registry.get("invalid").is_some());
    assert!(registry.get("nonexistent").is_none());
}

#[test]
fn test_registry_has_all_js_tools() {
    let registry = ToolRegistry::new();
    // Verify all tools from the JavaScript registry are present
    let tool_ids: Vec<&str> = registry.all().iter().map(|t| t.id()).collect();
    assert!(tool_ids.contains(&"bash"));
    assert!(tool_ids.contains(&"read"));
    assert!(tool_ids.contains(&"write"));
    assert!(tool_ids.contains(&"edit"));
    assert!(tool_ids.contains(&"glob"));
    assert!(tool_ids.contains(&"grep"));
    assert!(tool_ids.contains(&"list"));
    assert!(tool_ids.contains(&"webfetch"));
    assert!(tool_ids.contains(&"websearch"));
    assert!(tool_ids.contains(&"codesearch"));
    assert!(tool_ids.contains(&"batch"));
    assert!(tool_ids.contains(&"todowrite"));
    assert!(tool_ids.contains(&"todoread"));
    assert!(tool_ids.contains(&"multiedit"));
    assert!(tool_ids.contains(&"invalid"));
}

#[test]
fn test_registry_tool_count_matches_js() {
    let registry = ToolRegistry::new();
    // JavaScript registry has 15 tools
    assert_eq!(registry.all().len(), 15);
}

#[test]
fn test_registry_descriptions() {
    let registry = ToolRegistry::new();
    let descriptions = registry.descriptions();
    // Each tool should have a non-empty description (tuples of (id, description))
    for (id, description) in &descriptions {
        assert!(!id.is_empty());
        assert!(!description.is_empty());
    }
    assert_eq!(descriptions.len(), 15);
}
