// 判定 title / digest 长度限制的【计量单位】：字符 vs 字节
// 背景: 中文测试无法区分「64 个字符」和「192 字节」(64×3=192，两者结果完全相同)
// 解法: 用纯 ASCII 探测 (ASCII 在 UTF-8 / GBK 下均为 1 字节)
//   - 65 个 a 失败            -> 按字符计, 上限 64
//   - 65 成功但 128 失败      -> 按 GBK 字节计, 上限 ~128
//   - 128 成功但 192 失败     -> 按 UTF-8 字节计, 上限 ~192
// 用法: node wechat-limit-unit.mjs [凭证文件路径]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const credPath = process.argv[2] || path.join(process.cwd(), '.workbuddy', 'wechat-cred.json');
const API = 'https://api.weixin.qq.com';
const line = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const tok = await (
  await fetch(`${API}/cgi-bin/token?grant_type=client_credential&appid=${cred.appid}&secret=${cred.secret}`)
).json();
if (!tok.access_token) {
  line('换 token 失败: ' + JSON.stringify(tok));
  process.exit(1);
}
const token = tok.access_token;
line('token 就绪');

const png = makeCoverPng();
const boundary = '----wxunit' + Date.now().toString(16);
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
line('封面素材就绪');

const created = [];
let calls = 0;
async function tryDraft(title, digest) {
  calls++;
  const article = {
    title,
    author: 't',
    digest,
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
  return { ok: false, errcode: d.errcode };
}

const testTitleAscii = (n) => tryDraft('a'.repeat(n), 't');
const testDigestAscii = (n) => tryDraft('t', 'a'.repeat(n));

// 依次探测候选点，找到第一个失败的位置
async function probeUnit(label, testFn, chineseMax) {
  line('');
  line(`--- ${label}: 计量单位判定（中文上限已测得 ${chineseMax}）---`);
  const cands = [chineseMax + 1, chineseMax * 2, chineseMax * 3];
  const results = [];
  for (const n of cands) {
    const r = await testFn(n);
    results.push({ n, ok: r.ok, errcode: r.errcode });
    line(`  纯 ASCII ${n} 个 → ${r.ok ? '✅ 成功' : `❌ ${r.errcode}`}`);
    if (!r.ok) break;
  }
  const firstFail = results.find((x) => !x.ok);
  if (!firstFail) return { unit: '未定（全部成功，需扩大范围）', detail: results };
  if (firstFail.n === chineseMax + 1) return { unit: '字符（码点）', limit: chineseMax, detail: results };
  if (firstFail.n === chineseMax * 2) return { unit: `字节（GBK 口径，上限约 ${chineseMax * 2}）`, detail: results };
  if (firstFail.n === chineseMax * 3) return { unit: `字节（UTF-8 口径，上限约 ${chineseMax * 3}）`, detail: results };
  return { unit: `字节（介于 ${firstFail.n} 与上一档之间）`, detail: results };
}

const t = await probeUnit('title', testTitleAscii, 64);
const d = await probeUnit('digest', testDigestAscii, 120);

line('');
line('========================================');
line('单位判定结论');
line('========================================');
line(`title : ${t.unit}`);
line(`digest: ${d.unit}`);

// 若为字符制，再用混排验证一次（中文 63 + 英文 2 = 65 字符 / 191 字节）
if (t.unit.includes('字符')) {
  line('');
  line('--- 混排交叉验证（title = 63 个中文 + 2 个英文 = 65 字符 / 191 字节）---');
  const r = await tryDraft('字'.repeat(63) + 'ab', 't');
  line(`  65 字符 / 191 字节 → ${r.ok ? '✅ 成功（说明按字符计的说法存疑，65 字符竟然过了）' : `❌ ${r.errcode}（符合"字符制、上限 64"）`}`);
  const r2 = await tryDraft('字'.repeat(62) + 'ab', 't');
  line(`  64 字符 / 188 字节 → ${r2.ok ? '✅ 成功（符合"字符制、上限 64"）' : `❌ ${r2.errcode}`}`);
}

line('');
line(`清理 ${created.length} 条测试草稿...`);
let delOk = 0;
for (const mid of created) {
  const r = await fetch(`${API}/cgi-bin/draft/delete?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mid }),
  });
  const dd = await r.json();
  if (dd.errcode === 0 || dd.errcode === undefined) delOk++;
  await sleep(200);
}
line(`已删除 ${delOk}/${created.length} 条`);
line(`本次调用 ${calls} 次 draft/add`);
line('素材库多了一张紫色测试封面图，需手动删除');
