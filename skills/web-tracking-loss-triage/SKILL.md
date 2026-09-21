---
name: web-tracking-loss-triage
description: 排查"网页埋点事件丢失"（GA4/GTM/像素 page_view 不发、事件查不到、Realtime 看不到）。当用户说"PV 丢了""GA4 收不到数据""埋点不上报""只有某个浏览器/某台机器丢""DevTools 里看不到 collect"，或需要判断是观测伪影、配置、页面生命周期还是网络层时使用。核心是用「客观判据 + 分层排除 + 环境差异取证」代替反复猜机制。
agent_created: true
---

# 网页埋点事件丢失的分层排查

## 为什么需要这个 skill

真实事故（2026-09-17，一个 Astro + GTM + GA4 的静态博客，`page_view` 间歇性丢失）：排查耗时近 5 小时，连续做出**多个后来被自己推翻的结论**，全部源于同一类错误：**在不适用的路径上取数据，把空结果当成否证**。

典型翻车：
- 用 DevTools Network 面板判断"请求没发" → 实际是面板打开太晚 / 类型过滤停在 Fetch+XHR 隐藏了 Ping 类
- 在 `reload` 上测 `activationStart` 断言"预渲染已排除" → 预渲染由"选地址栏下拉建议"触发，reload 根本不在这条路径上
- 用"warm 页面"测"首次连接冷启动"，用"沙箱代理"测"用户本机 collect 可达性"

## 硬规则（先记这六条，能省 3 小时）

1. **判据只用客观量测，不用 DevTools 面板**。`performance.getEntriesByType('resource')` 过滤 `/g/collect` 是首选：不看 DevTools 是否打开、不受 Network 面板类型过滤影响。`sendBeacon` 类请求在面板里是 **Ping**，停在 Fetch/XHR 筛选就是瞎的。
2. **等 60 秒**。任何"没有请求"的结论，都必须覆盖批处理窗口后再下。取太早 = 假阴性。
3. **不要在假设不适用的路径上验证假设**。要证伪一个机制，就**伪造它成立的条件再做对照**（例：`add_init_script` 覆写 `Document.prototype.prerendering` 造出预渲染态），而不是在结构上不可能触发的路径上测一次。
4. **"同一个 profile / 同一容器在别处正常"不等于配置无罪**——但也别急着拆配置。先确认**差异变量到底是哪个**（见下）。
5. **模拟被质疑时，给模拟装客观量测**（事件计数器 + 位移 + 真实输入通道如 CDP `Input.dispatchMouseEvent`），而不是重复论证"我的模拟很真"。
6. **别把相邻字段当同一件事**。读配置类 JSON 必须逐字段核对语义（例：GTM 的 `tagFiringOption ≠ paused`；`network_prediction_options=2` 是"关闭"不是"默认"）。

## 分层排查顺序

### L0 先证伪观测层（最容易被跳过，也最容易翻车）
- 让用户在 Console 手动发一枚带唯一参数的 hit（`?m=manual-<分钟>`），去 GA4 Realtime 看是否出现。
  - 出现 → 网络/属性/过滤器通，问题在页面自身逻辑
  - 不出现 → 网络或属性侧

### L1 客观判据拿基线
无头浏览器（Playwright）跑同一 URL，拿**健康态基线**：collect 条数、`en=`、initiatorType、耗时。
- 健康态通常**几百毫秒**就发 `page_view`，不是 5 秒批处理
- 记下 `dataLayer` 序列：健康态也可能**没有 `config`/`event` 记录**（GTM 注入的 Google Tag 走内部队列）→ 别用"没有 config"当"Google Tag 没执行"的判据
- `typeof window.gtag` 在健康态也可能是 `undefined`（GTM 不暴露它）→ 同样不能当判据

### L2 头部插桩（唯一能回答"有没有尝试"的手段）
在 `<head>` **早于 GTM loader / 任何业务脚本**插同步脚本，包裹 `fetch` / `navigator.sendBeacon` / `XMLHttpRequest` / `window.Image` 的 src setter，各记 `call / resolve(status) / reject(err)` / `accepted / queue-failed` / `send / done`；`window.dataLayer` 要**先建数组再钩 push**，否则 GTM 会换掉你的数组。另记 `pagehide` / `visibilitychange` / `prerenderingchange` 与启动快照。
投放优先级：**Local Overrides（不碰线上）> 线上部署（用户授权后）**。
判读：`0 条 call` = 压根没尝试；`有 call 无 resolve` / `reject` = 尝试了没出去。

### L3 环境差异取证（"只有某个浏览器/某台机器坏"时必做）
不要靠猜，直接读配置：
- `%LOCALAPPDATA%\<Vendor>\<Browser>\User Data\Default\Preferences`（普通 JSON，可直读）
- `...\Default\Secure Preferences`（扩展清单在这里，**不在 Preferences**）
- `...\User Data\Local State`（`browser.enabled_labs_experiments` = chrome://flags；`policy`、`management` = 企业托管）
- 注册表 `HKCU\HKLM\Software\Policies\<Vendor>\<Browser>`
- **判断某个键是"用户改过"还是"默认值"的唯一可靠办法**：用同一份浏览器二进制 + 全新 `--user-data-dir` 起一次（`--headless=new --dump-dom about:blank` 即可初始化 profile），再对比该键**是否存在**。默认值往往**根本不写入 Preferences**。
- 有关键词就全文递归搜：`preload` / `prerender` / `prefetch` / `network_prediction` / `dark` / `proxy`
- 顺带看 `profile.exit_type`（`Crashed` = 上次异常退出），仅作旁证

### L4 生命周期
`document.prerendering`、`navigation.activationStart`、`visibilityState`、bfcache（`pageshow.persisted`）。
**已实测的机制**：gtag.js 在"预渲染态"下**根本不产生 hit**（不是产生后不发）——`__diag` 里连 `call` 都没有，且连 `_ga` client-id cookie 都不写。压制是**全局**的（`scroll` 等增强测量事件一并被压），激活后会补发。

### L5 网络层
只有"尝试了但没出去"才下来：`chrome://net-export/` → netlog viewer 搜域名，看有没有 `HTTP_TRANSACTION_SEND_REQUEST`。这是唯一不受观测伪影影响的 socket 级判据。

## 判读表模板（把"有没有尝试"和"有没有初始化"拆开）

| 证据形态 | 结论 |
|---|---|
| 插桩记录数 < 2 | 插桩没跑到 → 该次加载用了缓存里的旧 HTML → 硬刷新重来 |
| 0 条 collect 尝试，且 client-id cookie 也没写 | 目的地连初始化都没发生 → 生命周期门 |
| 0 条尝试，但 client-id cookie 在 | 已初始化，目标事件压根没生成 → 标签/config 层（`send_page_view` 等） |
| 有 call，但 reject / 无 resolve | 请求被创建过但没出去 → netlog |
| call + resolve 齐全 | 发了且成功 → 转 GA4 DebugView / 属性侧 |

## 「0 次尝试」之后怎么继续分叉（2026-09-17 实战）

拿到「插桩显示 0 次 collect 尝试」时**不要**直接跳到"gtag 内部逻辑有问题"。先拆成两支：

**支路 1：gtag 在执行、能发事件，只是跳过了目标事件**
最省事的判法——**同一次加载内做前后对照**：让用户**不刷新页面**，滚到页面底部再回顶，然后**再跑一次探针**。
- 出现 `fetch call(en=scroll)` 且 `_ga_<ID>` 的 `t` 推进 ⇒ gtag 在执行且能发事件 ⇒ 问题在"这个事件为什么没被生成"（`send_page_view`、config 路径、事件级配置）⇒ 转 GTM Preview + GA4 DebugView
- 依然什么都没有 ⇒ 走支路 2

**支路 2：脚本压根没执行**
用两个客观信号判断，别靠 DevTools：
- `Object.keys(window.google_tag_manager || {})` —— 容器跑没跑（有 GTM 容器 id 说明 gtm.js 执行了）
- resource timing 里 `gtag/js` / `gtm.js` 条目：`responseStatus`、`transferSize`（0 且 `decodedBodySize>0` = 来自浏览器缓存）、`decodedBodySize`（与新鲜抓取的体积对比 → 能发现缓存里的**截断/损坏脚本**）
- 顺带记 `performance.timeOrigin`：若远早于"现在 − 页面存活秒数"，说明是 bfcache 恢复的老文档（脚本不会重跑、事件不会重发）

**容器侧先核对再定罪**：导出 JSON 里找该 googtag 标签的
- `configSettingsTable` / `send_page_view` 参数（**没有**这个表 = 自动 page_view 走 gtag 默认「开」）
- 测量 ID 变量是不是**常量**（若是 dataLayer 驱动，ID 可能解析成空）
- `paused` 和 `firingTriggerId`（别用 `tagFiringOption` 代替 `paused`）

**关于 cookie 时间戳的纪律**：`_ga_<ID>` 的 `s`（会话起点）/`t`（最后事件）与页面 boot 时间只差 1–2 秒时（秒级粒度），**不能**据此断言"本页执行过/没执行过"。别把这种边界证据当结论。

## 容器侧高频真凶：config 标签被重复触发（2026-09-18 结案线索）

**症状**：目标事件（如 `page_view`）压根没生成（0 次上传尝试），但 destination 已初始化（`_ga`、`_ga_<ID>` 都在），且**其它事件（scroll 等）照常能发**。只有部分环境/部分导航复现。

**检查项（按顺序）**：
1. 把容器导出 JSON 里那个 **Google Tag / GA4 配置标签**的 `firingTriggerId` 全列出来。**只要里面除了 `Initialization - All Pages`(2147479573) / `All Pages`(2147479553) 之外还有 `History Changes`(41)，就是反官方写法。**
2. Google 官方 SPA 指南的要求：History Change 触发器要挂在一个**独立的「GA4 事件」标签**上（事件名 `page_view`），**config 标签每次页面加载只初始化一次、不应被反复触发**。多个触发条件挂在 config 标签上 = 每次 history 变更重跑 `gtag('config', ...)`。
3. 机制：gtag 的「同一页面 page_view 只发一次」簿记与 destination 初始化绑定。同一 destination 被多次 config 时，会出现「init 状态建立 + cookie 写入，但 page_view 未发出」的组合。二次 config 与 gtag.js 加载完成之间的**竞争窗口**落在哪一侧决定成败 —— 这解释了为什么只有长期 profile / 特定导航复现。
4. **但别就此结案**：先用 GTM Preview 在纯手敲导航（不带参数）下确认**到底有没有 `gtm.historyChange` 事件**。
   - 有 → 双触发即病因，结案
   - 没有 → 站点根本不产生 history 变更（**非 SPA 站点常见**：先 grep 线上 HTML 的 `pushState|replaceState|history\.|onpopstate|hashchange`），那"删触发器"与"变正常"就是两件独立的事，病因仍未知（很可能是同批操作里重新发布容器连带改掉的别的变更）
   - 触发源不一定在站点代码里：Cloudflare 的 `/cdn-cgi/challenge-platform/scripts/jsd/main.js`、Chrome 在部分加载/会话恢复路径上派发的 `popstate`、扩展的 URL 改写，都可能产生 history change

**收尾别忘**：调试期往线上塞的诊断脚本（一般放在站点布局文件的 BEGIN/END 之间）要等稳定性验证做完再撤 —— 撤早了就没有 `window.__diag` 可读。撤之前先跑「连续 5 次不同 `?m=` 刷新 + 两条入口（手敲 / 地址栏下拉建议）」，并确认**每次加载只产生一条目标事件**（别从"丢"变成"重复"）。

## 坑（都真实踩过）

- **cookie 名别写错**：GA4 已去掉 `G-` 前缀，cookie 是 `_ga_<MEASUREMENT_ID>`，不是 `_ga_G-<MEASUREMENT_ID>`。
- **`_ga_<ID>` 的 `t`（last-event 时间）不能当"有没有发过 hit"的判据**：无头环境里连健康态都不写该 cookie（只写 `_ga`），无法标定。
- **同域第一方转发 / 服务端 GTM（Stape、GTG）会改变 collect 落点**，历史证据可能被污染；先确认容器里有没有生效的 `transport_url`。
- **容器导出 JSON 可能是"工作区草稿"不是线上版本**（看 `containerVersionId`）；核对线上的办法是直接解析 `gtm.js` 内嵌定义（线上会比导出多出若干个 GTM 自动注入的监听器标签 `__fsl/__cl/__hl/__lcl`）。
- **无痕模式默认不启用扩展**，"无痕正常"既不能证明扩展无罪，也不能证明有罪。
- **拦截器/扩展会包裹 `fetch`/`sendBeacon`**，所以插桩本身也可能被包裹 —— 记录里带上 `Function.prototype.toString()` 的指纹，能发现被改写的原生方法。

## 工具链建议

| 环节 | 用什么 | 为什么 |
|---|---|---|
| 拿健康态基线 / 造控条件 | Playwright（`add_init_script` 可覆写原型造预渲染态） | 能构造在真实浏览器上无法稳定复现的路径 |
| 客观量测 | `performance.getEntriesByType('resource')` + 头部同步插桩 | 不依赖 DevTools 状态，可留存为证据 |
| 环境差异 | 直读浏览器 profile 的 Preferences / Secure Preferences / Local State | 绕开"猜我装了什么扩展" |
| socket 级取证 | `chrome://net-export/` + netlog viewer | 唯一不受观测伪影影响的一层 |
| 容器侧 | 容器导出 JSON + 线上 `gtm.js` 内嵌定义对比 | 导出可能是草稿，线上才是真相 |

**注意**：插桩要放在 `<head>` 里、早于 GTM loader；若用无头浏览器做取证，记住无头环境的行为与真实浏览器在 cookie 写入上可能不一致（见上）。
