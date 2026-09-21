# Martech Agent Skills

Practical, incident-derived skills for AI coding agents working on **B2B SaaS marketing operations** — tracking, analytics, GEO, and content distribution.

Not tutorials. Each skill is a **decision framework** distilled from a real failure and the hours it cost. The value is in the judgment calls, not the API calls.

[中文说明 →](./README.zh-CN.md)

---

## The problem this solves

Most tracking/marketing "troubleshooting" content on the internet tells you what to click:

> Open GTM Preview. Check the Network tab. Verify your tag is firing.

That advice fails exactly when you need it most. When `page_view` goes missing intermittently, "check the Network tab" is how you spend five hours producing three conclusions you later have to retract — because the Network tab was **closed too early**, or its type filter was **parked on Fetch+XHR and silently hiding Ping-class beacons**.

These skills replace guessing with **objective instrumentation + layered elimination**.

## Published

| Skill | What it's for | Core idea |
|---|---|---|
| [`web-tracking-loss-triage`](./skills/web-tracking-loss-triage/SKILL.md) | GA4 / GTM / pixel events not firing (`page_view` lost, Realtime empty) | Objective criteria over DevTools panels. Separate "did it try" from "did it initialize" before theorizing about mechanism. |

## In the queue

Being cleaned one at a time — published only once all credentials, property IDs, and machine-specific paths are stripped.

| Skill | What it's for | Core idea |
|---|---|---|
| `geo-ai-crawler-policy` | Configuring `robots.txt` + `llms.txt` for generative engines | Three-class AI crawler taxonomy (retrieval / user-triggered / training) with verified UA lists. |
| `wechat-mp-draft` | WeChat Official Account API → draft box | Full chain plus six field-tested traps, incl. the GBK-weighted length ceiling on `title`/`digest`. |
| `content-platform-adaptation` | Rewriting one finished article per platform (WeChat / Zhihu / LinkedIn / X) | Publish different versions per platform, not copies — and re-check every self-referential claim per platform. |
| `bilibili-up-analysis` | Scraping and analyzing a Bilibili creator's full video catalogue | Working pipeline around the platform's risk-control (`-352`) instead of fighting it. |

## How to use these

Written for the [Agent Skills](https://www.anthropic.com/news/skills) format (`SKILL.md` with YAML frontmatter). Drop a skill folder into your agent's skills directory:

```
~/.claude/skills/web-tracking-loss-triage/SKILL.md
~/.workbuddy/skills/web-tracking-loss-triage/SKILL.md
```

The bodies are in Chinese because that is the working language of the professional context they came from. Structure and technique are language-neutral — an agent reads them fine, and English versions are welcome as PRs.

## What's deliberately **not** here

- **Vendor/connector-specific skills** tied to one person's account or private repo layout. They don't transfer.
- **Platform-specific environment workarounds** (e.g. "PowerShell stdout isn't captured in tool X"). Highly effective locally, worthless one version later. Those belong in blog posts, not skills.
- Anything containing credentials, property IDs, or personal identifiers.

## Contributing

Corrections to the judgment calls are more valuable than new skills. If you've hit the same class of incident and your elimination order differs, open an issue describing **what evidence changed your mind** — that's the part worth capturing.

## License

MIT — see [LICENSE](./LICENSE).
