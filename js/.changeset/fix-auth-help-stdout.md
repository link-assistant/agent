---
'@link-assistant/agent': patch
---

fix: display CLI help text on stdout instead of stderr

When running `agent auth` without a subcommand, the help text was displayed
on stderr, causing it to appear in red in many terminals. Help text is
informational and should go to stdout, following the industry standard
behavior of CLI tools like git, gh, and npm.
