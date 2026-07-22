# Security Policy

Thank you for helping keep the **OpenClaw ↔ Agentic Orchestration** plugin and its users safe.

This package (`@zlatko-lakisic/openclaw-agentic-orchestration`) runs **inside the OpenClaw gateway** with conversation-hook privileges. With the default **managed backend**, it can also **download**, **patch**, **install dependencies for**, and **spawn** a local [agentic-orchestration](https://github.com/zlatko-lakisic/agentic-orchestration) stack. Treat it as a high-trust extension of OpenClaw, not a sandboxed toy.

Engine-side issues that live purely in the monorepo should be reported against [agentic-orchestration](https://github.com/zlatko-lakisic/agentic-orchestration/security) when the plugin is only a client. Report **here** when the bug is in the plugin, ClawHub package, managed bootstrap, patches, or how the plugin wires OpenClaw → the engine.

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest published on [ClawHub / npm](https://github.com/zlatko-lakisic/agentic-orchestration-openclaw/releases) (`package.json` version) | ✅ |
| Previous patch on the same major | ⚠️ Critical/high only, best effort |
| Older majors / unpublished forks | ❌ Please upgrade |

Pin installs to a known version in production gateways when you need reproducibility.

## Reporting a vulnerability

**Do not open a public GitHub Issue for security vulnerabilities.**

### Preferred: GitHub private vulnerability reporting

1. Open [zlatko-lakisic/agentic-orchestration-openclaw](https://github.com/zlatko-lakisic/agentic-orchestration-openclaw)
2. **Security** → **Report a vulnerability** (or [new advisory](https://github.com/zlatko-lakisic/agentic-orchestration-openclaw/security/advisories/new))
3. Include:
   - Plugin version (`package.json` / ClawHub version) and OpenClaw gateway version
   - Whether `managedBackend` was `true` or `false`
   - Config relevant to the bug (redact secrets; describe key presence only)
   - Attack scenario, impact, and reproduction steps
   - Whether credentials, conversation content, or host filesystem were reachable beyond intended policy

We aim to **acknowledge within 3 business days** and provide an initial triage within **7 business days**.

### Coordinated disclosure

| Severity (indicative) | Target fix / advisory window |
|-----------------------|------------------------------|
| Critical | ASAP; typically ≤ 7 days after confirmed repro |
| High | ≤ 14 days |
| Medium | ≤ 30 days |
| Low / hardening | Next plugin release or documented mitigation |

We may publish a GitHub Security Advisory (and CVE when appropriate) and credit reporters who wish to be named. Fixes may also require a coordinated release of the engine monorepo and/or a ClawHub republish.

### Out of scope (use normal issues/PRs)

- OpenClaw core gateway bugs (report to the OpenClaw project)
- Pure engine bugs with no plugin-specific trigger (report to [agentic-orchestration](https://github.com/zlatko-lakisic/agentic-orchestration/security))
- Prompt injection that only causes the orchestrator to use MCP tools the operator already enabled
- Issues that require the reporter to already control the OpenClaw host as a local admin, unless they demonstrate unexpected privilege relative to OpenClaw’s own model

## Threat model (summary)

### Trust boundaries

| Boundary | Assumption |
|----------|------------|
| **OpenClaw gateway process** | The plugin runs with gateway privileges; malicious plugin code would equal host compromise |
| **`hooks.allowConversationAccess`** | Required for this plugin; grants conversation access — only enable for plugins you trust |
| **Managed backend bootstrap** | May fetch a **pinned** GitHub release archive, write under OpenClaw state dirs, create a Python venv, patch `server.mjs` when needed, and spawn Node/Python. Re-download requires `autoUpdate: true` |
| **Local checkout preference** | `AGENTIC_ORCHESTRATION_ROOT` / sibling checkouts are trusted like operator-controlled source |
| **HTTP bridge** | Calls `POST /api/v1/orchestrate` on the web server; auth depends on `apiKey` / `AGENTIC_ORCHESTRATE_API_KEY` |
| **Credential mapping** | May copy OpenClaw `models.providers` / allowlisted env LLM keys into the backend worker env; auth-profile disk scans and `.env` writes are opt-in |

### High-impact issue classes we care about

- Remote or cross-user code execution via plugin config, patches, or bootstrap
- Supply-chain compromise of the ClawHub/npm package, `patches/*`, or download URL verification gaps (unexpected host, missing integrity checks, path traversal while extracting)
- Authentication bypass to the orchestrate API when a key is configured
- Leakage of API keys, conversation content, or host paths into logs, errors, or untrusted channels
- Session confusion / reply injection across OpenClaw sessions when `sessionPassthrough` is enabled
- Privilege escalation beyond the filesystem and network scope the operator intended for the managed backend

### Explicit non-goals

- “The LLM did something surprising with an enabled tool” without a plugin/engine policy bypass
- Securing an OpenClaw gateway that was intentionally exposed to the public Internet without OpenClaw’s own auth — still useful as hardening advice

## Operator hardening checklist

1. **Only install** this plugin from the official ClawHub package name `@zlatko-lakisic/openclaw-agentic-orchestration` (verify publisher).
2. Set **`hooks.allowConversationAccess: true` only for this trusted plugin**; review other plugins with the same privilege.
3. Prefer a **local checkout** you control (`AGENTIC_ORCHESTRATION_ROOT` / `preferLocalCheckout`) in sensitive environments instead of downloading on first run.
4. Keep **`autoUpdate: false`** (default) unless you intentionally want re-downloads; pin with `backendRef` (default `v1.14.0`).
5. Leave **`persistCredentials`** / **`discoverAuthProfiles`** off unless you need disk `.env` materialization or auth-profile scanning.
6. Set a strong shared **`apiKey`** in plugin config and the same value as **`AGENTIC_ORCHESTRATE_API_KEY`** on the web server when the HTTP port is reachable beyond localhost.
7. For production, consider **`managedBackend: false`** and run a hardened, pinned engine deployment (see engine [SECURITY.md](https://github.com/zlatko-lakisic/agentic-orchestration/blob/main/SECURITY.md)).
8. Restrict which MCP credentials and agent providers exist in the backend env / catalogs — the plugin inherits that blast radius.
9. Keep OpenClaw, Node, and the plugin updated; restart the gateway after upgrades.
10. Do not paste plugin config containing secrets into public issues or chat logs.

## Safe harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and interruption of production services
- Do not exploit a vulnerability beyond what is needed to demonstrate it
- Report findings privately and give us time to remediate before public disclosure
- Do not use social engineering or physical attacks against maintainers or users

## Supply chain

- Prefer version-pinned installs; review release tags and `dist/` changes on upgrades
- Managed bootstrap should only pull from the expected GitHub repository for agentic-orchestration; report any unsigned / unexpected download behavior
- Engine container images (when you point at a remote orchestrator) should come from `ghcr.io/zlatko-lakisic/...` as documented upstream

## Related

- Engine security policy: [agentic-orchestration/SECURITY.md](https://github.com/zlatko-lakisic/agentic-orchestration/blob/main/SECURITY.md)
- External integrations docs: [External integrations](https://zlatko-lakisic.github.io/agentic-orchestration/external-integrations/)
- Plugin README: [README.md](./README.md)

## Contact

Primary channel: **GitHub Security Advisories** on this repository.  
Maintainer: [@zlatko-lakisic](https://github.com/zlatko-lakisic)
