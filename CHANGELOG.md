# Changelog

## 0.2.2 - 2026-09-19

- Refresh display identity metadata on first observation and identity changes, even when an
  OpenClaw pane has no model or context metadata to report.

## 0.2.1 - 2026-09-19

- Parse the OpenClaw footer when `session` wraps before its `tui-…` identifier, preserving
  per-pane display identities such as `Lumen (main)` in narrow Herdr panes.

## 0.2.0 - 2026-09-19

- Parse OpenClaw 2026.9.4 model and context metadata, including hard-wrapped info lines.
- Report every pane under the stable `openclaw` lifecycle label while deriving a distinct
  display identity from the OpenClaw TUI footer.
- Document managed, pinned Herdr installation and the supported OpenClaw version.

## 0.1.0

- Initial Herdr plugin for reporting OpenClaw TUI panes.
