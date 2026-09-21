---
name: wechat-mp-draft
description: 通过微信公众号官方 API 把内容写入草稿箱（Markdown/HTML 排版 → 上传封面 → draft/add → 回读校验）。覆盖微信开发者平台凭证配置、IP 白名单排错、排版兼容性硬规则、六个实测踩坑点（含 draft/get 编码坑）、title/digest 的 GBK 加权长度上限（含边界探测方法论），以及正文 content 的 2 万字符限制为何不成立。触发词：公众号、草稿箱、draft、发布到公众号、推到公众号、wechat mp、mp.weixin。
agent_created: true
version: 0.2.0
---

# wechat-mp-draft

把内容写进微信公众号**草稿箱**（不是直接发布）。发布必须人工在后台点。

## 一、前置配置（一次性）

**入口位置在 2025-12-01 变了**：整个「开发接口管理」从 `mp.weixin.qq.com` 后台迁移到了**微信开发者平台**。旧路径【设置与开发 → 开发接口管理】已失效，网上大量教程还是旧的。

新路径：

1. `https://developers.weixin.qq.com/platform/` → 右上角「登录」→ **公众号管理员微信**扫码
2. 「我的业务」→ 选中目标公众号
3. 「**开发密钥**」区域 —— AppID、AppSecret、API IP 白名单三者都在这一页
4. 复制 AppID；AppSecret 点「启用/重置」，扫码确认，**只显示一次**
5. **IP 白名单**填入调用机器的公网 IPv4

**顺序陷阱**：如果没看到白名单的编辑入口，是因为 AppSecret 还没启用 —— **必须先完成第 4 步，白名单按钮才出现**。

白名单细节：只能填单个公网 IP，**不支持 CIDR 网段**；多个 IP 用**换行**分隔（不是逗号）；每次保存都要管理员扫码；**生效需 5–10 分钟**，刚存完立刻测一定失败。数量上限口径为 5~8 个。

凭证存本地 JSON，不要提交仓库。默认读 `./.workbuddy/wechat-cred.json`（`--cred` 可覆盖）：

```json
{"appid":"wx...","secret":"..."}
```

## 二、核心三步（顺序不可逆）

```
1. GET  /cgi-bin/token?grant_type=client_credential&appid=&secret=
        → access_token，有效期 7200s，务必缓存复用

2. POST /cgi-bin/material/add_material?access_token=&type=image
        multipart/form-data，字段名 media
        → 永久素材 media_id（封面用，必须走这步）

3. POST /cgi-bin/draft/add?access_token=
        {"articles":[{title, author, digest, content, thumb_media_id, ...}]}
        → 草稿 media_id
```

正文内嵌图片另走 `POST /cgi-bin/media/uploadimg`，返回的是 URL（非 media_id），替换进 content 的 `<img src>`。

## 三、账号能力边界（实测）

| 接口 | 个人主体订阅号 | 说明 |
|---|---|---|
| `token` | ✔ | 白名单配好即可 |
| `material/add_material` | ✔ | 已实测通过 |
| `draft/add` | ✔ | 已实测通过 |
| `freepublish/submit` | ✘ | 官方明文"仅认证"，个人主体永远拿不到 |

**结论**：个人号能做到「排版 + 传图 + 进草稿箱」全自动，最后一步人工点发布。社区流传的"个人号一律 48001"是错的，至少 draft 链路可用。

## 四、六个实测踩坑（重要）

1. **成功响应不带 `errcode` 字段。** 例如 `material/add_material` 成功直接返回 `{"media_id":...,"url":...}`。**判定成功必须看结果字段本身（media_id / url），用 `errcode === 0` 判断会把成功全判成失败。**

2. **`draft/add` 的封面是硬性要求。** `thumb_media_id` 传空字符串、或整个字段缺失，都返回 `40007 invalid media_id`。必须先跑第 2 步拿 media_id。

3. **Node/undici 的 `FormData` 上传微信接口不可靠**（返回非 JSON，解析出 errcode=undefined）。改为**手工构造 multipart body**：自定 boundary、显式拼 `Content-Disposition: form-data; name="media"; filename="x.png"` 与 `Content-Type`，再拼二进制与结尾 `--boundary--`。

4. **`40164` 的报错里会同时回显两个 IP**：IPv4 和它的 `::ffff:` 映射形式。先填 IPv4，仍失败再补映射形式（微信双栈时确实有只认后者的情况）。报错里回显的 IP 是**微信实际看到的来源 IP**，用它核对，别只信本机探测结果。

5. **标题 / 摘要的长度上限，官方文档写错了。** 文档写"32 字 / 128 字"，实测是 **GBK 加权 128 / 240**（中文计 2、ASCII 计 1）。按文档的"32 字"卡会白白浪费一半可用额度。完整边界值与探测方法见第八节。

6. **`draft/get` 的响应头是 `Content-Type: text/plain`，不带 charset。** requests 会默认按 **ISO-8859-1** 解码 → **中文全部变乱码，且长度虚高约 3 倍**（一个中文字 3 字节 → 3 个字符），看起来像"服务端把内容存坏了/二次转义了"。必须取**原始字节自己按 UTF-8 解析**：

   ```python
   r = requests.post(url, ...)
   data = json.loads(r.content)      # ✅ 对
   data = r.json()                   # ❌ 中文乱码
   ```

## 五、错误码速查

| 码 | 含义 | 处理 |
|---|---|---|
| 40164 | IP 不在白名单（errmsg 回显真实 IP） | 去开发者平台加白名单 |
| 61004 | 未配置白名单 IP | 同上 |
| 40243 | AppSecret 被冻结 | 开发者平台解冻/重置 |
| 40125 | AppSecret 无效 | 重置 |
| 40013 | AppID 无效 | 检查复制是否完整 |
| 48001 | 接口无权限 | 账号类型不支持该接口 |
| 40007 | media_id 无效/缺失 | 补封面素材 |
| 45003 / 45004 | 标题 / 摘要超长 | 加权长度上限 128 / 240（中文计 2、西文计 1，即 GBK 字节数） |

## 六、正文排版硬规则（微信编辑器兼容性）

微信编辑器兼容性差，`<section>` + 内联样式复制进去大概率丢格式。

- **唯一验证过的方案是 table 骨架**：`<table>` + `<tr>` + `<td>` 作结构，样式全部打在 `<td>` 上，内容放 `<p>` 里（等同 HTML 邮件的思路）
- **可用样式**：color / background-color / font-size / font-weight / padding / margin / border / text-align / line-height
- **会破坏布局的样式（别用）**：position / linear-gradient / 伪元素 —— 这类会真的裂
- **会被忽略、但无害降级的样式**：border-radius —— 渲染引擎只是丢掉该属性，圆角变直角，不影响结构。`md2wechat.py` 的 styled 主题就故意在 inline code 上保留了 `border-radius:3px`，属这一类

## 七、脚本

`scripts/` 下的脚本，按需使用。

依赖：**Node ≥ 18**（`.mjs` 用 `node:` 前缀导入）；Python 侧需 `requests` + `Pillow`（`md2wechat.py` 只用标准库）。

| 脚本 | 用途 |
|---|---|
| `wechat-check.mjs` | 端到端连通性验证：探测出口 IP → 读凭证 → 换 token → 上传测试封面 → 写测试草稿，按错误码给判定 |
| `wechat-limit-unit.mjs` | **判定长度限制的计量单位**（字符 vs 字节）：用纯 ASCII 探测。中文测不出单位——64 字符与 192 字节（64×3）结果完全重合，必须换 ASCII 补测 |
| `wechat-limit-test.mjs` | 二分探测 title / digest 的中文字符数边界 |
| `wechat-limit-exact.mjs` | 卡精确边界 + 中英混排交叉验证加权模型，自带草稿与素材清理 |
| `md2wechat.py` | Markdown → 微信兼容 HTML（table 骨架 + 内联样式），`--style lean\|styled`、`--out` |
| `wechat-push.py` | **完整推送链**：读凭证 → 换 token（带缓存）→ 生成 900×383 封面并上传 → draft/add → **draft/get 回读逐字校验** |

```bash
python scripts/md2wechat.py 文章.md --style styled --out content.html   # 只排版
python scripts/wechat-push.py --md 文章.md --style styled                 # 排版 + 推送 + 回读校验
python scripts/wechat-push.py --md 文章.md --thumb <已有封面 media_id>    # 复用封面，不新增素材
python scripts/wechat-push.py --md 文章.md --no-cover                     # 不生成封面
```

生成的封面落在 `skills/wechat-mp-draft/outputs/cover.png`（已 gitignore）。封面副标题默认不显示，需要时用 `--cover-sub "自定义副标题"`。中文字体按平台自动探测（Windows 微软雅黑 / macOS PingFang / Linux Noto CJK），都找不到会退回 PIL 默认字体并告警。

测试脚本会在后台留下测试草稿和紫色封面素材（`wechat-limit-exact.mjs` 会清理自己产生的），跑完去后台确认一眼。

## 八、标题与摘要的长度上限（实测结论）

| 字段 | 加权上限 | = 中文字数 | = 纯 ASCII 字符数 |
|---|---|---|---|
| title | **128** | 64 字 | 128 字符 |
| digest | **240** | 120 字 | 240 字符 |

加权算法：**中文字符计 2、ASCII 字符计 1** —— 即 GBK 字节数。超限报 `45003`（标题）/ `45004`（摘要）。

官方文档写的"32 字 / 128 字"与实测不符；网络流传的"64 / 120 字节"数字对但单位错（64 个中文字 = 128 加权单位，不是 64 字节）。

**排查方法论**：只用中文测试**无法**区分"64 个字符"与"192 字节"两种规则 —— 64 × 3 = 192 恰好重合，结果完全一样。必须换纯 ASCII 补测（128 成功 / 129 失败、240 成功 / 241 失败）才能反推出中西文权重不同的加权模型。遇到任何"单位存疑"的长度限制，都用这个换字符集的办法验证。

## 九、正文 content 的 2 万字符限制 —— 文档写了，运行时不管

官方对 `content` 的说明是「**必须少于 2 万字符，小于 1M**」，社区也普遍照此传。

**实测结论（2026-09-17，个人主体订阅号）：不拦截。**

- 推送 **54,809 字符**的 content（10 张表、286 个带样式的标签、整篇长文）→ `draft/add` 返回 `{"media_id": "...", "item": []}`，**成功**。
- `draft/get` 回读比对：**服务端 54,809 字符，与本地完全一致（差 +0），逐字一致**。
- 这是「文档限制比运行时更严」的又一例（同第八节）。**按文档自我设限就会白白压缩内容。**

注意：`小于 1M` 是字节口径，本次 payload UTF-8 约 110KB，**1M 那条是否生效未测**。

**那什么才是真约束？** 不是 API，是**手机端渲染**。要判断"文章会不会过长"，别看接口，看渲染：

- **标记开销**：转成微信兼容 HTML 后，标签与内联样式占 content 的 77%~85%，是文字本身的 3~6 倍。10 张表 176 个单元格 ≈ 350 个带样式的标签。
- **表格宽度**：微信正文可用宽约 343px ≈ 21 个汉字。列多或单元格文字长的表（如 9 行 × 3 列的错误码表）在手机上会被压到难读，应改成「列表式」或转图。
- **代码块**：微信 `<pre>` 不支持横向滚动，超长行会折行或溢出（实测某代码块 22 行、最长 93 字符宽）。超过 15 行的代码块建议**转图片**。
- **阅读时长**：正文净重 8,000+ 字符 ≈ 10–12 分钟，属公众号深度长文正常区间；**2,500 汉字以内的题材更好读**。

**所以压缩顺序应按渲染价值排，不是按配额排**：宽表转文本行 → 长代码块转图 → 附录移出正文 → 最后才考虑拆篇。
