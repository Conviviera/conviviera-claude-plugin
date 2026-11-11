# Maintainer tests for the Conviviera Claude plugin

This branch holds one file that is not part of the plugin: `smoke.mjs`, the
plugin's smoke test (zero dependencies, Node 20 or newer).

It lives here, not on `main`, because the Claude directory publishes `main` and,
for organizations it has not verified, accepts only Markdown, text, JSON, YAML
and images there.

Run it against a checkout of `main`:

```bash
PLUGIN_ROOT=/path/to/checkout-of-main node smoke.mjs                 # static checks
PLUGIN_ROOT=/path/to/checkout-of-main SMOKE_LIVE=1 node smoke.mjs    # plus unauthenticated discovery reads
```

The **Validate plugin** workflow on `main` fetches this file and runs it on
every push and pull request. The live checks only read public discovery
documents and send one unauthenticated `initialize`, which must answer 401.

Change the test here in the same piece of work that changes what it checks on
`main`, and push this branch first.
