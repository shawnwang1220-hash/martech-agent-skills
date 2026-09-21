# -*- coding: utf-8 -*-
"""
md2wechat.py —— Markdown -> 微信公众号兼容 HTML

用途：
  1. 把 drafts/ 下的 markdown 转成可提交给 draft/add 的 content HTML；
  2. 提交前先校验 content 字符数是否逼近微信的 2 万字符硬上限（含标签、属性全算）。

用法：
  python md2wechat.py <input.md> [--style lean|styled] [--out out.html]

结构遵循微信编辑器的兼容性硬规则：
  table 作骨架，样式打在 td 上，内容放 p 里；只用 color / background-color /
  font-size / font-weight / padding / margin / border / text-align / line-height。
"""
import re
import sys
import html as _html

# ---------------------------------------------------------------- 样式表
# lean：极简，只保证可读，标记开销最小
# styled：接近常见公众号排版，视觉更好但标记开销大（直接影响 2 万字符配额）
STYLES = {
    "lean": {
        "table": 'style="width:100%;border-collapse:collapse"',
        "td": '',
        "h2": 'style="font-size:20px;font-weight:bold;margin:36px 0 16px"',
        "h3": 'style="font-size:17px;font-weight:bold;margin:28px 0 12px"',
        "p": 'style="margin:0 0 18px;line-height:1.8"',
        "li": 'style="margin:0 0 10px;line-height:1.8"',
        "code": 'style="font-family:Consolas,monospace;font-size:14px"',
        "pre": 'style="font-family:Consolas,monospace;font-size:13px;background-color:#f6f6f6;padding:12px;margin:0 0 18px;line-height:1.6;word-break:break-all;white-space:pre-wrap"',
        "quote": 'style="border-left:3px solid #ddd;padding-left:12px;color:#666;margin:0 0 18px"',
        "th": 'style="border:1px solid #ddd;padding:8px;background-color:#f6f6f6;font-weight:bold;text-align:left"',
        "cell": 'style="border:1px solid #ddd;padding:8px"',
    },
    "styled": {
        "table": 'style="width:100%;border-collapse:collapse;table-layout:fixed"',
        "td": 'style="padding:0;vertical-align:top"',
        "h2": 'style="font-size:20px;font-weight:bold;color:#2c3e50;line-height:1.5;margin:40px 0 18px;padding-left:10px;border-left:4px solid #7f8c8d"',
        "h3": 'style="font-size:17px;font-weight:bold;color:#34495e;line-height:1.5;margin:30px 0 14px"',
        "p": 'style="margin:0 0 20px;font-size:16px;line-height:1.85;color:#3f3f3f;text-align:justify;letter-spacing:0.5px"',
        "li": 'style="margin:0 0 12px;font-size:16px;line-height:1.85;color:#3f3f3f"',
        "code": 'style="font-family:Menlo,Consolas,monospace;font-size:14px;background-color:#f2f2f2;color:#c7254e;padding:2px 5px;border-radius:3px"',
        "pre": 'style="font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;background-color:#f7f7f7;color:#333;padding:14px;margin:0 0 22px;word-break:break-all;white-space:pre-wrap"',
        "quote": 'style="border-left:4px solid #bdc3c7;background-color:#fafafa;padding:14px 16px;color:#5f5f5f;font-size:15px;line-height:1.8;margin:0 0 20px"',
        "th": 'style="border:1px solid #dcdcdc;padding:10px;background-color:#f0f0f0;font-size:15px;font-weight:bold;color:#2c3e50;text-align:left;line-height:1.6"',
        "cell": 'style="border:1px solid #dcdcdc;padding:10px;font-size:15px;color:#3f3f3f;line-height:1.7"',
    },
}


def esc(t):
    return _html.escape(t, quote=False)


def inline(t, S):
    """行内元素：code / strong / em / 链接。"""
    t = re.sub(r"`([^`]+)`", lambda m: f'<code {S["code"]}>{esc(m.group(1))}</code>', t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', t)
    return t


def split_row(line, S, tag):
    sty = S["th"] if tag == "th" else S["cell"]
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return "".join(f"<{tag} {sty}><p style=\"margin:0\">{inline(c, S)}</p></{tag}>" for c in cells)


def convert(md, style="styled"):
    S = STYLES[style]
    lines = md.splitlines()
    # 去 frontmatter
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                lines = lines[i + 1:]
                break

    out, i, n = [], 0, len(lines)
    while i < n:
        ln = lines[i]
        s = ln.strip()

        if not s:
            i += 1
            continue

        # 代码块
        if s.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            code = "\n".join(buf)
            out.append(f'<p {S["pre"]}>{esc(code)}</p>')
            continue

        # 表格
        if s.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            body = [r for r in rows if not re.match(r"^\|[\s:|-]+\|$", r.strip())]
            trs = []
            for k, r in enumerate(body):
                trs.append("<tr>" + split_row(r, S, "th" if k == 0 else "td") + "</tr>")
            out.append(f'<table {S["table"]}>' + "".join(trs) + "</table>")
            out.append(f'<p {S["p"]}></p>')
            continue

        # 分隔线
        if re.match(r"^-{3,}$", s):
            out.append('<p style="border-top:1px solid #e5e5e5;margin:30px 0;font-size:0;line-height:0">&nbsp;</p>')
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            lvl = min(len(m.group(1)), 3)
            key = "h2" if lvl <= 2 else "h3"
            out.append(f'<{key} {S[key]}>{inline(m.group(2), S)}</{key}>')
            i += 1
            continue

        # 引用
        if s.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            txt = "<br/>".join(inline(x, S) for x in buf if x)
            out.append(f'<p {S["quote"]}>{txt}</p>')
            continue

        # 列表
        if re.match(r"^([-*+]|\d+\.)\s+", s):
            buf = []
            while i < n and re.match(r"^([-*+]|\d+\.)\s+", lines[i].strip()):
                buf.append(re.sub(r"^([-*+]|\d+\.)\s+", "", lines[i].strip()))
                i += 1
            items = "".join(f'<p {S["li"]}>• {inline(x, S)}</p>' for x in buf)
            out.append(items)
            continue

        # 段落
        buf = [s]
        i += 1
        while i < n and lines[i].strip() and not re.match(
            r"^(#{1,6}\s|\||```|>|[-*+]\s|\d+\.\s|-{3,}$)", lines[i].strip()
        ):
            buf.append(lines[i].strip())
            i += 1
        out.append(f'<p {S["p"]}>{inline("".join(buf), S)}</p>')

    body = "\n".join(out)
    if S["td"]:
        return f'<table {S["table"]}><tr><td {S["td"]}>\n{body}\n</td></tr></table>'
    return body


if __name__ == "__main__":
    path = sys.argv[1]
    style = "styled"
    out_path = None
    if "--style" in sys.argv:
        style = sys.argv[sys.argv.index("--style") + 1]
    if "--out" in sys.argv:
        out_path = sys.argv[sys.argv.index("--out") + 1]

    src = open(path, encoding="utf-8").read()
    result = convert(src, style)

    plain = re.sub(r"<[^>]+>", "", result)
    print(f"源文件      : {path}")
    print(f"排版风格    : {style}")
    print(f"content 长度: {len(result):,} 字符   (微信上限 20,000)")
    print(f"  占比      : {len(result)/20000*100:.1f}%")
    print(f"  其中纯文本: {len(plain):,} 字符")
    print(f"  标记开销  : {len(result)-len(plain):,} 字符 ({(len(result)-len(plain))/len(result)*100:.0f}%)")
    print("  结论      : " + ("❌ 超出上限，必须精简" if len(result) >= 20000 else "✅ 在上限内"))
    if out_path:
        open(out_path, "w", encoding="utf-8").write(result)
        print(f"已写出      : {out_path}")
