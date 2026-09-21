---
name: geo-ai-crawler-policy
description: 为网站配置面向生成式引擎（GEO）的基础设施：robots.txt 的 AI 爬虫三类策略（检索型 / 用户触发型 / 训练型）+ Content-Signal 用途声明 + llms.txt 内容索引。含 2026 年核实的完整 UA 名单、常见写错点与校验清单，以及 social / sameAs 类「同一事实两处引用」的漂移防范。触发词：GEO、生成式引擎优化、llms.txt、AI 爬虫、robots.txt、GPTBot、AI 引用、禁止训练、Content-Signal、AI 可见性、AI搜索引擎收录、sameAs、实体消歧。
agent_created: true
---

# GEO 基础设施：AI 爬虫策略与 llms.txt

## 0. 先厘清优先级：什么真正影响 AI 引用

1. **页面能被抓取** —— robots.txt / CDN 是否放行检索型爬虫
2. **内容结构清晰** —— 直接回答、问答式小标题、原创可引用事实
3. **结构化数据** —— Organization / Person / Article / FAQPage
4. **robots.txt 的 AI 决策** —— 本 skill 的主题
5. ……然后才是 llms.txt

**llms.txt 是廉价期权，不是策略。** 2026 年测量：主流 AI 爬虫（GPTBot / ClaudeBot / PerplexityBot / OAI-SearchBot / Google-Extended）基本不抓 `/llms.txt`，站点采用率约 10%，Google 已明确表示不支持（Gary Illyes 确认无计划，John Mueller 比作 keywords meta）。**做它，但别包装成能提升 AI 可见性的手段。** 它的现实收益在开发者工具侧（Cursor、Claude Projects 会读）和面向 agent 的长期期权。

## 1. 三类爬虫 —— 这是全部策略的基础

| 类型 | 行为 | 对 GEO 的意义 | 策略 |
| --- | --- | --- | --- |
| **检索型** | 建立 AI 搜索索引，回答时返回链接与摘录 | **决定内容能否被引用** | 必须 Allow |
| **用户触发型** | 用户当场让 AI 读某个 URL 时的即时抓取 | 禁止会让「帮我总结这个链接」失败 | Allow |
| **训练型** | 抓取喂模型权重，无引用回流 | 与 GEO 无关 | 可 Disallow |

### 完整 UA 名单（2026 年核实）

**检索型 → Allow**
`Googlebot`、`Bingbot`、`OAI-SearchBot`、`Claude-SearchBot`、`PerplexityBot`、`Applebot`、`DuckAssistBot`、`YouBot`

**用户触发型 → Allow**
`ChatGPT-User`、`Claude-User`、`Perplexity-User`、`meta-externalfetcher`

**训练型 → 可 Disallow**
`GPTBot`、`ClaudeBot`、`Google-Extended`、`Applebot-Extended`、`CCBot`、`meta-externalagent`、`Amazonbot`、`Bytespider`、`cohere-ai`、`Diffbot`、`Omgilibot`、`AI2Bot`

### 四个必须知道的细节

**① 核心结论：禁止训练型爬虫不损失任何 AI 搜索可见性。** 引用回流靠检索型，训练型只喂模型权重。这是「既要保护内容、又想被引用」的解法，也是推荐默认策略。

**② `Google-Extended` 与 `Applebot-Extended` 不是爬虫，是 robots.txt 里的用途开关。**
- `Google-Extended` 控制内容能否用于训练 Gemini / Vertex **以及 Gemini 应用的 grounding**，**不影响 Google Search 排名**（AI Overviews 走 Googlebot）。
- `Applebot-Extended` 只控制 Apple Intelligence 训练，不影响 `Applebot` 的检索。
- 取舍：禁 `Google-Extended` 会失去 Gemini 应用的 grounding 引用。若要保 Gemini 引用，删掉这一段即可 —— 这一取舍必须写进 robots.txt 注释交给用户决定。

**③ 两支「用户触发型」可能不遵守 robots.txt。**
OpenAI 文档称 robots.txt 对 `ChatGPT-User` "may not apply"；Perplexity 称 `Perplexity-User` "generally ignores robots.txt"；`Bytespider` 有明确的不遵守记录。写上只是表态，真拦截要在 CDN / 源站层做（WAF 规则 / 403）。

**④ 绝不禁止 `Googlebot` 与 `Bingbot`。** 它们同时喂 Google Search + AI Overviews、Bing + Copilot，共享同一个索引 —— 禁止等于自断流量，且不只是 AI 层面的损失。

## 2. robots.txt 模板

```robots.txt
User-agent: *
Allow: /

Content-Signal: search=yes, ai-input=yes, ai-train=no, use=reference

Sitemap: https://example.com/sitemap-index.xml

# ── 检索型 ──
User-agent: Googlebot
Allow: /
（其余同构）

# ── 训练型 ──
User-agent: GPTBot
Disallow: /
（其余同构）
```

`Content-Signal` 四个字段：

| 字段 | 含义 |
| --- | --- |
| `search=yes` | 建搜索索引、返回链接与短摘要 |
| `ai-input=yes` | 生成回答时读取内容（RAG / grounding），会带回引用 |
| `ai-train=no` | 不用于训练或微调 |
| `use=reference` | 可索引、可摘录、可引用；不可复述或整体再现（Cloudflare 的扩展字段） |

- 写法：放在 `User-agent: *` 段内（Cloudflare 官方示例如此）。
- 法律意义：欧盟 DSM 指令 2019/790 第 4 条允许权利人用机器可读方式保留 TDM 权，此声明即该保留。
- 已知副作用：GSC 可能报 **"Syntax not understood"** —— Cloudflare 官方说明不影响抓取率与 SEO，不必处理。

### 常见写错点（写错了都静默失效，构建期零反馈）

| 错误 | 后果 |
| --- | --- |
| 同一 UA 段里 `Allow: /` 与 `Disallow: /` 并存 | 后者优先，语义互相抵消 |
| 重复出现同一个 `User-agent` 段 | 解析器取哪个不确定 |
| 文件带 UTF-8 BOM | 首行指令可能被当乱码 |
| CRLF 与 LF **混用** | 部分解析器拆错行（纯 CRLF 无害） |
| 只写 `User-agent: *` 就想禁训练型 | 通配段会把它们一起放行，必须逐个列出 |
| 以为 robots.txt 能拦住不守规矩的爬虫 | 它只是声明，不是访问控制 |

## 3. llms.txt

格式（llmstxt.org，**只认根路径 `/llms.txt`**）：
- H1：站点 / 品牌名 —— 唯一必需元素
- blockquote：一段摘要 —— 强烈建议
- 若干 H2 分节，每节一组 `- [名称](绝对URL): 一句话说明`
- 节标题为 `## Optional` 的，表示 token 紧张时 AI 可以跳过
- 内容要**人工筛选**（10–40 条），不是 sitemap 转储 —— 它相对 sitemap 的唯一优势就是编辑判断

**务必动态生成，不要手写。** 静态站用构建期端点（Astro：`src/pages/llms.txt.ts` 导出 `GET`；其他框架同理）。手写的文件会随内容增加悄悄过期，**而过期的 llms.txt 比没有更糟**。

- 发布为 `text/plain`
- 它**不会被 sitemap 集成自动收录**（实测），也不需要
- 多语言站点：一个根文件里按语言分节即可，不必为每个语言各出一份
- 可选：`llms-full.txt` 把所有正文内联成一个文件供 agent 一次读全 —— 只有内容量大时才有价值

## 4. 校验清单（写完逐项过，建议固化成脚本进 CI）

- [ ] 检索型 8 支全部 `Allow: /`
- [ ] 训练型 12 支全部 `Disallow: /`
- [ ] 无重复 UA 段
- [ ] 无段内 `Allow` + `Disallow` 同时指向 `/`
- [ ] `Content-Signal` 存在，且含 `ai-train=no` 与 `search=yes`
- [ ] `Sitemap:` 指令存在
- [ ] 无 BOM；无混用行尾
- [ ] `/llms.txt` 可达，H1 + blockquote 齐备
- [ ] llms.txt 内所有链接是**绝对 URL**，站内页面链接**带尾斜杠**（与 canonical 规则一致，否则读者拿到 308 地址）
- [ ] llms.txt 的链接目标在构建产物中真实存在
- [ ] 线上实测：`curl -I https://<域名>/robots.txt` 与 `/llms.txt` 均 200

### 4.1 校验脚本本身的两个坑（踩过）

**不要用正则匹配 JSON-LD 的字符串形态。** 产物通常是 `JSON.stringify(x, null, 2)` 输出的，
实际是 `"@type": "Person"`（冒号后有空格）。`/"@type":"Person"/` 这类正则会把正确的东西
全部判成缺失。改用 `JSON.parse` 后做结构化断言：

```js
const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
const graph = JSON.parse(m[1])["@graph"];
```

**断言「同一实体在多处被引用」时，把跨来源对齐写成一条硬断言。** GEO 场景里最容易出错的
不是「有没有」，而是**同一份事实出现在两个地方、随后各自演化**（例如社交主页既有页面
`<a href>` 又有 `sameAs`，同一枚 URL 有两份真源）。写成「页面上出现的每个 URL 都必须在
`sameAs` 里」这种逐条对齐的断言，比分别检查「不少于 N 条」有效得多 —— 后者漏掉漂移。

**定位容器要用完整的开始标签**，不能只给 class 名：产物里 `class="row"` 之类的兄弟节点会让
`lastIndexOf("<div")` 落错位置，取到空容器、报假警报。用整段 `<div class="row resume-socials"`
去 `indexOf`，再用 `/<(\/?)div\b/g` 计数配平。

## 5. 跨平台执行注意（Windows 侧）

- 校验脚本**写成 `.mjs` 文件再跑**，不要用 `node -e '...'` 内联 —— Git Bash 会吞掉 `\s` / `\S` 的反斜杠，导致 `SyntaxError: Invalid regular expression`。
- `core.autocrlf=true` 下，Windows 侧 checkout 与**本地构建产物是 CRLF**，线上（Linux 构建）是 LF。**纯 CRLF 不是缺陷**（RFC 9309 要求解析器两种都接受），校验时只把**混用行尾**当错误，纯 CRLF 降级为提示。
- 生成的 robots.txt 若被 `.gitignore` 的宽泛规则（如裸 `*.png`、`*.txt`）挡住，`git add -A` 会**静默跳过** —— 提交后用 `git ls-tree -r --name-only HEAD -- <dir>` 复核真的进库了。
