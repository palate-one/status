# Incident template

Copy this template to `content/incidents/inc-YYYY-MM-DD-short-slug.md` only for a
confirmed, approved public incident. Replace every placeholder before opening a
pull request. This file is a template, not a production incident.

```yaml
---
id: "inc-YYYY-MM-DD-short-slug"
title: "<short public title>"
status: "investigating" # investigating | identified | monitoring | resolved
severity: "degraded" # degraded | partial_outage | major_outage
components: ["<web or api>"]
startedAt: "<RFC 3339 timestamp with timezone>"
resolvedAt: null # required when status is resolved
---
```

Write updates below the frontmatter. Include the RFC 3339 update time, user
impact, and current mitigation. State only verified facts; do not guess at a
root cause. Use public component names (`web` and `api`) only.

Never publish emails, user or provider identifiers, private notes, exact
locations, tokens, secrets, internal hosts, object keys, request bodies, or
unverified provider payloads. Run the focused content-schema test and review the
rendered preview before merging. Remove an unapproved or placeholder entry
instead of publishing it.
