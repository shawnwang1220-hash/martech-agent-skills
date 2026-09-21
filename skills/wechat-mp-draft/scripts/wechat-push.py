# -*- coding: utf-8 -*-
"""
wechat-push.py —— 把 Markdown 排版后写进微信公众号草稿箱

流程：读凭证 → 换 access_token（带缓存） → 生成并上传封面（永久素材）
      → draft/add → draft/get 回读校验

用法：
  python wechat-push.py --md drafts/xxx.md --style styled
  python wechat-push.py --md drafts/xxx.md --style lean --no-cover
  python wechat-push.py --md drafts/xxx.md --thumb <已有封面 media_id>

依赖：requests、Pillow
"""
import argparse
import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from md2wechat import convert  # noqa: E402

BASE = "https://api.weixin.qq.com"
HERE = os.path.dirname(os.path.abspath(__file__))

# 默认凭证路径：当前工作目录下的 .workbuddy/wechat-cred.json
# 用 --cred 覆盖。
DEFAULT_CRED = os.path.join(os.getcwd(), ".workbuddy", "wechat-cred.json")


def wlen(s):
    """GBK 加权长度：非 ASCII 计 2，ASCII 计 1。title ≤128、digest ≤240。"""
    return sum(2 if ord(c) > 127 else 1 for c in s)


def load_cred(path):
    with open(path, encoding="utf-8") as f:
        c = json.load(f)
    return c["appid"], c["secret"]


def get_token(appid, secret, cache_path, force=False):
    if not force and os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            c = json.load(f)
        if c.get("expires_at", 0) > time.time() + 120:
            print(f"[token] 命中缓存，剩余 {int(c['expires_at']-time.time())}s")
            return c["access_token"]
    r = requests.get(
        f"{BASE}/cgi-bin/token",
        params={"grant_type": "client_credential", "appid": appid, "secret": secret},
        timeout=20,
    )
    d = r.json()
    if "access_token" not in d:
        print("[token] ❌ 失败:", json.dumps(d, ensure_ascii=False))
        sys.exit(1)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump({"access_token": d["access_token"], "expires_at": time.time() + d.get("expires_in", 7200)}, f)
    print(f"[token] ✅ 拿到，有效期 {d.get('expires_in')}s")
    return d["access_token"]


def _pick_font(size, bold=False):
    """跨平台挑一个可用的中文字体，找不到则退回 PIL 默认字体。

    硬编码单一平台字体路径会让脚本在别的系统上直接崩，因此按平台列候选、
    逐个探测存在性。
    """
    from PIL import ImageFont

    if sys.platform == "win32":
        candidates = [
            r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
            r"C:\Windows\Fonts\msyh.ttc",
            r"C:\Windows\Fonts\simhei.ttf",
        ]
    elif sys.platform == "darwin":
        candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
            if bold
            else "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/arphic/uming.ttc",
        ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    print("[cover] ⚠️ 未找到可用中文字体，退回 PIL 默认字体（中文可能显示为方框）")
    return ImageFont.load_default()


def make_cover(path, title, sub=""):
    from PIL import Image, ImageDraw

    W, H = 900, 383
    img = Image.new("RGB", (W, H), (46, 58, 66))
    d = ImageDraw.Draw(img)
    for i in range(H):  # 竖向渐变
        t = i / H
        d.line([(0, i), (W, i)], fill=(int(46 + 18 * t), int(58 + 22 * t), int(66 + 26 * t)))
    f1 = _pick_font(46, bold=True)
    f2 = _pick_font(22)

    lines, cur = [], ""
    for ch in title:
        if d.textlength(cur + ch, font=f1) > W - 120:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    lines.append(cur)

    y = H / 2 - (len(lines) * 62 + 40) / 2
    for ln in lines:
        tw = d.textlength(ln, font=f1)
        d.text(((W - tw) / 2, y), ln, font=f1, fill=(240, 243, 245))
        y += 62
    if sub:
        tw = d.textlength(sub, font=f2)
        d.text(((W - tw) / 2, y + 6), sub, font=f2, fill=(150, 170, 180))
    d.rectangle([0, H - 6, W, H], fill=(127, 189, 160))
    img.save(path, "PNG")
    print(f"[cover] 生成 {W}x{H} -> {path}")
    return path


def upload_cover(token, img_path):
    with open(img_path, "rb") as f:
        r = requests.post(
            f"{BASE}/cgi-bin/material/add_material",
            params={"access_token": token, "type": "image"},
            files={"media": (os.path.basename(img_path), f, "image/png")},
            timeout=60,
        )
    d = r.json()
    if "media_id" not in d:
        print("[cover] ❌ 上传失败:", json.dumps(d, ensure_ascii=False))
        sys.exit(1)
    print(f"[cover] ✅ media_id={d['media_id']}")
    return d["media_id"]


def add_draft(token, article):
    payload = {"articles": [article]}
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    r = requests.post(
        f"{BASE}/cgi-bin/draft/add",
        params={"access_token": token},
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=90,
    )
    return r.text


def get_draft(token, media_id):
    """回读草稿。

    ⚠️ 坑：draft/get 响应头是 `Content-Type: text/plain`，不带 charset，
    requests 会默认按 ISO-8859-1 解码 → 中文全变乱码（且长度虚高 3 倍）。
    必须取 r.content 原始字节，按 UTF-8 自己解析。
    """
    r = requests.post(
        f"{BASE}/cgi-bin/draft/get",
        params={"access_token": token},
        data=json.dumps({"media_id": media_id}, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=60,
    )
    return json.loads(r.content)


def delete_draft(token, media_id):
    r = requests.post(
        f"{BASE}/cgi-bin/draft/delete",
        params={"access_token": token},
        data=json.dumps({"media_id": media_id}, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=30,
    )
    print("[清理] delete ->", r.text)


def main():
    ap = argparse.ArgumentParser(
        description="Markdown -> 微信兼容 HTML -> 公众号草稿箱（含回读逐字校验）",
    )
    ap.add_argument("--md", required=True, help="Markdown 源文件")
    ap.add_argument("--style", default="styled", choices=["lean", "styled"])
    ap.add_argument(
        "--cred",
        default=DEFAULT_CRED,
        help='凭证 JSON 路径，格式 {"appid":"wx...","secret":"..."}（默认 ./.workbuddy/wechat-cred.json）',
    )
    ap.add_argument("--no-cover", action="store_true", help="不生成/上传封面（需配合 --thumb 使用）")
    ap.add_argument("--no-verify", action="store_true", help="跳过 draft/get 回读校验")
    ap.add_argument("--thumb", default="", help="复用已有封面的 media_id，不新增素材")
    ap.add_argument("--title", default="", help="覆盖 frontmatter 的 title")
    ap.add_argument("--digest", default="", help="覆盖 frontmatter 的 description")
    ap.add_argument("--cover-sub", default="", help="封面副标题，默认不显示")
    ap.add_argument("--out", default="", help="另存一份排版后的 HTML")
    args = ap.parse_args()

    src = open(args.md, encoding="utf-8").read()
    fm = {}
    if src.startswith("---"):
        for ln in src.split("---")[1].strip().splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                fm[k.strip()] = v.strip().strip('"')
    title = args.title or fm.get("title", "")
    digest = args.digest or fm.get("description", "")

    while wlen(digest) > 238:  # 摘要超限则截断（留 2 加权单位余量）
        digest = digest[:-1]
    print(f"[字段] title 加权 {wlen(title)}/128 | digest 加权 {wlen(digest)}/240")
    if wlen(title) > 128:
        print("       ❌ 标题超限")
        sys.exit(1)

    content = convert(src, args.style)
    print(f"[排版] 风格 {args.style} -> content {len(content):,} 字符（微信文档口径上限 20,000，实测不拦截）")
    if args.out:
        open(args.out, "w", encoding="utf-8").write(content)

    appid, secret = load_cred(args.cred)
    print(f"[凭证] appid={appid[:8]}...（已加载）")
    token = get_token(appid, secret, os.path.join(os.path.dirname(args.cred), "wechat-token.json"))

    thumb = args.thumb
    if not thumb and not args.no_cover:
        cover = os.path.abspath(os.path.join(HERE, "..", "outputs", "cover.png"))
        os.makedirs(os.path.dirname(cover), exist_ok=True)
        make_cover(cover, title[:24], args.cover_sub)
        thumb = upload_cover(token, cover)

    article = {"article_type": "news", "title": title, "content": content, "digest": digest}
    if thumb:
        article["thumb_media_id"] = thumb
    print(f"[draft] 提交中… (content {len(content):,} 字符)")
    resp = add_draft(token, article)
    print("[draft] 返回:", resp)

    try:
        mid = json.loads(resp).get("media_id")
    except Exception:
        mid = None
    if mid and not args.no_verify:
        d = get_draft(token, mid)
        srv = d["news_item"][0]["content"]
        print(f"[回读] 服务端 {len(srv):,} 字符 vs 本地 {len(content):,}（差 {len(srv)-len(content):+,}）")
        print(f"[回读] 逐字一致: {'✅' if srv == content else '❌ 有差异，需人工核对'}")
        if srv != content:
            import difflib

            n = 0
            for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, content, srv, autojunk=False).get_opcodes():
                if tag == "equal":
                    continue
                n += 1
                if n > 5:
                    break
                print(f"       {tag}: 本地 {content[i1:i2][:60]!r} -> 服务端 {srv[j1:j2][:60]!r}")
        print(f"[草稿] media_id = {mid}")


if __name__ == "__main__":
    main()
