# Martech Agent Skills

面向 AI Agent 的 **B2B SaaS 营销运营**实战技能库 —— 覆盖埋点追踪、数据分析、GEO 与内容分发。

不是教程。每个技能都是从一次真实事故里蒸馏出来的**判断框架**。真正值钱的是那些判断，不是 API 调用。

[English →](./README.md)

---

## 这个库解决什么问题

网上关于埋点排查的内容大多在告诉你点哪里：

> 打开 GTM Preview。看 Network 面板。确认标签触发了。

**这种建议恰恰在最需要它的时候失效。** 当 `page_view` 间歇性丢失时，"看 Network 面板"就是让你花 5 小时、连着得出三个后来必须自己推翻的结论的原因——因为面板**打开太晚**，或者类型过滤器**停在 Fetch+XHR 上、把 Ping 类 beacon 悄悄藏了**。

本库用**客观插桩 + 分层排除**取代猜机制。

## 已发布

| 技能 | 解决什么 | 核心思路 |
|---|---|---|
| [`web-tracking-loss-triage`](./skills/web-tracking-loss-triage/SKILL.md) | GA4 / GTM / 像素事件不发（`page_view` 丢失、Realtime 看不到） | 用客观量测代替 DevTools 面板。先拆开「有没有尝试」和「有没有初始化」，再谈机制。 |
| [`geo-ai-crawler-policy`](./skills/geo-ai-crawler-policy/SKILL.md) | 为生成式引擎配置 `robots.txt` + `llms.txt` | AI 爬虫三分类（检索型 / 用户触发型 / 训练型）+ 已核实 UA 名单。禁训练型爬虫不损失任何 AI 搜索可见性——引用回流靠检索型，不靠训练型。 |
| [`wechat-mp-draft`](./skills/wechat-mp-draft/SKILL.md) | 公众号官方 API → 草稿箱 | 全链路 + 六个实测坑，含 `title`/`digest` 的 GBK 加权长度上限（官方文档的单位写错了）。附 6 个可跑脚本：连通性探针、三个边界探针、Markdown→HTML 转换器、以及带回读逐字校验的完整推送链。 |

| [`content-platform-adaptation`](./skills/content-platform-adaptation/SKILL.md) | 一篇定稿改写成各平台专用版本（公众号 / 知乎 / 领英 / X） | 各平台发不同版本、不逐字复制，并逐平台复核「自证句」是否还成立。跨平台迁移的是**论点**，不是原文。 |

## 待发布队列

一个一个清理中——只有把凭证、测量 ID、本机路径全部剥离干净才会发布。

| 技能 | 解决什么 | 核心思路 |
|---|---|---|
| `bilibili-up-analysis` | 抓取并分析 B 站 UP 主全量视频 | 绕开平台风控（`-352`）的可用管线，而不是硬刚 |

## 怎么用

按 Agent Skills 规范编写（`SKILL.md` + YAML frontmatter）。把技能目录放进你的 agent 技能路径即可：

```
~/.claude/skills/web-tracking-loss-triage/SKILL.md
~/.workbuddy/skills/web-tracking-loss-triage/SKILL.md
```

正文是中文，因为这就是这些经验产生的职业语境。结构和技术与语言无关，agent 读得懂；英文版本欢迎提 PR。

## 故意**没有**放进来的东西

- **绑定某个账号或私有仓库结构的连接器技能** —— 不具备可迁移性
- **特定平台的环境绕过手段**（例如"某工具不回传 PowerShell stdout"）—— 本机极其有效，换个版本立刻失效。这类内容属于博客，不属于技能
- 任何含凭证、测量 ID、个人标识的内容

## 贡献

**修正判断，比新增技能有价值得多。** 如果你踩过同一类事故、但排除顺序不同，欢迎开 issue 说明**是哪条证据改变了你的结论**——那部分才值得沉淀。

## 许可

MIT，见 [LICENSE](./LICENSE)。
