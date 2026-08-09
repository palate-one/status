# Maintenance template

Copy this template to `content/maintenance/maint-YYYY-MM-DD-short-slug.md` only
for an approved public maintenance window. Replace every placeholder before
opening a pull request. This file is a template, not a production maintenance
notice.

```yaml
---
id: "maint-YYYY-MM-DD-short-slug"
title: "<short public title>"
status: "scheduled" # scheduled | in_progress | completed | cancelled
components: ["<web or api>"]
startsAt: "<RFC 3339 timestamp with timezone>"
endsAt: "<RFC 3339 timestamp with timezone>" # null until known; required when completed
---
```

Describe the user-visible scope, expected effect, and the public completion or
cancellation update. Keep `endsAt` later than `startsAt`; a completed notice
must include its actual end time. Use public component names (`web` and `api`)
only.

Never publish emails, user or provider identifiers, private notes, exact
locations, tokens, secrets, internal hosts, object keys, request bodies, or raw
provider payloads. Run the focused content-schema test and review the rendered
preview before merging. Remove an unapproved or placeholder entry instead of
publishing it.
