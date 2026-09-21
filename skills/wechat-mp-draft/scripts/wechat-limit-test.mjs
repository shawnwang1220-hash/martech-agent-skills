// 微信公众号 draft/add 的 title / digest 长度上限实测
// 用法: node wechat-limit-test.mjs [凭证文件路径]
// 探测方式: 单点定性 + 二分逼近，测完自动删除所有测试草稿

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const credPath = process.argv[2] || path.join(process.cwd(), '.workbuddy', 'wechat-cred.json');
const API = 'https://api.weixin.qq.com';
const line = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byteLen = (s) => Buffer.byteLength(s, 'utf8');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeCoverPng(w = 900, h = 383) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3;
      raw[p] = 0x53;
      raw[p + 1] = 0x4a;
      raw[p + 2] = 0xb7;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 初始化 ----------
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const tok = await (
  await fetch(`${API}/cgi-bin/token?grant_type=client_credential&appid=${cred.appid}&secret=${cred.secret}`)
).json();
if (!tok.access_token) {
  line('换 token 失败: ' + JSON.stringify(tok));
  process.exit(1);
}
const token = tok.access_token;
let egress = '';
try {
  egress = (await (await fetch('https://myip.ipip.net/', { signal: AbortSignal.timeout(8000) })).text())
    .trim()
    .replace(/\s+/g, ' ');
} catch {
  /* 探测失败不影响主流程 */
}
line(`token 就绪${egress ? '  ' + egress : ''}`);

// 上传一次封面，全程复用
const png = makeCoverPng();
const boundary = '----wxlim' + Date.now().toString(16);
const mpBody = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
    'utf8'
  ),
  png,
  Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
]);
const mr = await (
  await fetch(`${API}/cgi-bin/material/add_material?access_token=${token}&type=image`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: mpBody,
  })
).json();
if (!mr.media_id) {
  line('封面素材上传失败: ' + JSON.stringify(mr));
  process.exit(1);
}
const thumbId = mr.media_id;
line(`封面素材 media_id 就绪`);

// ---------- 测试基建 ----------
const created = [];
let calls = 0;

async function tryDraft(title, digest) {
  calls++;
  const article = {
    title,
    author: 't',
    digest,
    // 正文保持极短，避免它干扰判断
    content: '<p>t</p>',
    thumb_media_id: thumbId,
    content_source_url: '',
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
  const r = await fetch(`${API}/cgi-bin/draft/add?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles: [article] }),
  });
  const d = await r.json();
  await sleep(250);
  if (d.media_id) {
    created.push(d.media_id);
    return { ok: true };
  }
  return { ok: false, errcode: d.errcode, errmsg: d.errmsg };
}

// 只变 title，digest 固定短值
const testTitle = (n) => tryDraft('测'.repeat(n), '测试');

// 只变 digest，title 固定短值
const testDigest = (n) => tryDraft('限位测试', '摘'.repeat(n));

// 单点定性 + 逐步扩边 + 二分逼近
async function searchMax(label, testFn, start, hardLimit) {
  line('');
  line(`--- 探测 ${label} ---`);
  const r0 = await testFn(start);
  line(`  ${start} 字 (${start * 3} 字节) → ${r0.ok ? '✅ 成功' : `❌ ${r0.errcode}`}`);

  let lo, hi;
  if (r0.ok) {
    lo = start;
    let h = start;
    let capped = true;
    while (capped) {
      h = Math.min(h * 2, hardLimit);
      if (h <= lo) break;
      const rr = await testFn(h);
      line(`  ${h} 字 (${h * 3} 字节) → ${rr.ok ? '✅ 成功' : `❌ ${rr.errcode}`}`);
      if (!rr.ok) {
        hi = h;
        capped = false;
      } else {
        lo = h;
        if (h >= hardLimit) break;
      }
    }
    if (capped) return { lo, hi: null };
  } else {
    hi = start;
    let l = start;
    while (true) {
      l = Math.max(Math.floor(l / 2), 1);
      if (l >= hi) return { lo: 0, hi };
      const rr = await testFn(l);
      line(`  ${l} 字 (${l * 3} 字节) → ${rr.ok ? '✅ 成功' : `❌ ${rr.errcode}`}`);
      if (rr.ok) {
        lo = l;
        break;
      }
      hi = l;
      if (l <= 1) return { lo: 0, hi };
    }
  }

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const rr = await testFn(mid);
    line(`  ${mid} 字 (${mid * 3} 字节) → ${rr.ok ? '✅ 成功' : `❌ ${rr.errcode}`}`);
    if (rr.ok) lo = mid;
    else hi = mid;
  }
  return { lo, hi };
}

// ---------- 跑测试 ----------
const titleRes = await searchMax('title（中文字符数）', testTitle, 25, 200);
const digestRes = await searchMax('digest（中文字符数）', testDigest, 60, 600);

// ---------- 结论 ----------
line('');
line('========================================');
line('结论');
line('========================================');
const fmt = (res, name) => {
  if (res.hi === null) return `${name}: 上限 > ${res.lo} 字（探测范围不足）`;
  if (res.lo === 0) return `${name}: 连 1 字都失败，需人工介入`;
  return `${name}: **${res.lo} 个中文字符**（= ${res.lo * 3} 字节）可用，${res.hi} 字（${res.hi * 3} 字节）报错`;
};
line(fmt(titleRes, 'title '));
line(fmt(digestRes, 'digest'));

line('');
line(`判定参考:`);
line(`  "32 字"说 -> title 应在 32 左右;  "64 字节"说 -> title 应在 21 左右`);
line(`  "128 字"说 -> digest 应在 128 左右; "120 字节"说 -> digest 应在 40 左右`);

// ---------- 清理 ----------
line('');
line(`清理 ${created.length} 条测试草稿...`);
let delOk = 0;
for (const mid of created) {
  const r = await fetch(`${API}/cgi-bin/draft/delete?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mid }),
  });
  const d = await r.json();
  if (d.errcode === 0 || d.errcode === undefined) delOk++;
  await sleep(200);
}
line(`已删除 ${delOk}/${created.length} 条（后台草稿箱请顺手确认一眼）`);
line(`本次共调用 ${calls} 次 draft/add`);
line(`注意: 素材库多了一张紫色测试封面图，需手动删除`);
