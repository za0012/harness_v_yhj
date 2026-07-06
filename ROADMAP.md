# Roadmap

## Current Direction

Build a near-realtime Tool-Use Flight Recorder + Prompt Recommender for Codex work first, while keeping the trace schema generic enough for other AI agent runtimes.

## Current Scope

- Codex task recording through supervisor plans and desktop-thread bridge requests.
- Prompt, model response, tool call, tool result, retry, blocker, validation, outcome, and metric events.
- Prompt diagnosis and prompt recommendation from recorded traces.
- Before/after evaluation after recorder and recommender are stable.

## Later Upgrade

### Fully Automatic Codex Monitoring

Automatically watch every Codex Desktop thread and ingest activity without explicit supervisor plans or desktop-thread bridge requests.

This is intentionally deferred because it likely needs deeper Codex Desktop app integration, reliable thread discovery, permissions, and stable access to thread/tool events. Until then, use near-realtime recording through the supervisor + desktop-thread bridge.
