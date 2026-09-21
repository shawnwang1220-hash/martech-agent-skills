// 精确确定 title / digest 上限，并验证「中文计 2、西文计 1」的加权模型
// 已知: 中文 64 成功 / 65 失败; ASCII 128 成功 / 192 失败 => 猜想上限 = 128 (加权单位)
// 用法: node wechat-limit-exact.mjs [凭证文件路径]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const credPath = process.argv[2] || path.join(process.cwd(), '.workbuddy', 'wechat-cred.json');
const API = 'https://api.weixin.qq.com';
const line = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 加权长度: 中文(非 ASCII) 计 2, ASCII 计 1  —— 即 GBK 字节数
const wlen = (s) => {
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0) < 128 ? 1 : 2;
  return n;
};

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
  line('换 token 失败');
  process.exit(1);
}
const token = tok.access_token;
line(`token 就绪 (${tok.access_token.slice(0, 6)}...)`);

const png = makeCoverPng();
const boundary = '----wxexact' + Date.now().toString(16);
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
const thisMaterial = mr.media_id;
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

const testTitle = (s) => tryDraft(s, 't');
const testDigest = (s) => tryDraft('t', s);

async function bisect(label, testFn, loOk, hiFail) {
  line('');
  line(`--- ${label}: 精确边界（已知 ${wlen(loOk ? '' : '')}）---`);
  let L = loOk;
  let R = hiFail;
  while (L + 1 < R) {
    const mid = Math.floor((L + R) / 2);
    const r = await testFn('a'.repeat(mid));
    line(`  ASCII ${mid} → ${r.ok ? '✅ 成功' : `❌ ${r.errcode}`}`);
    if (r.ok) L = mid;
    else R = mid;
  }
  line(`  => 纯 ASCII 上限 = ${L}，第 ${R} 个开始报错`);
  return { max: L, firstFail: R };
}

const t = await bisect('title', testTitle, 128, 192);
const d = await bisect('digest', testDigest, 240, 360);

// ---------- 混排验证: 中文 N 个 + ASCII M 个，看是否卡在加权值 ----------
line('');
line('--- 混排边界验证（中文计 2 + ASCII 计 1）---');
async function mixTest(label, testFn, zh, ascii, expect) {
  const s = '字'.repeat(zh) + 'a'.repeat(ascii);
  const r = await testFn(s);
  const w = wlen(s);
  const verdict = r.ok === expect ? '✔ 符合预期' : '✘ 与模型不符';
  line(`  ${label}: ${zh}中文+${ascii}ASCII = 加权 ${w} → ${r.ok ? '✅ 成功' : `❌ ${r.errcode}`}  ${verdict}`);
  return r.ok;
}

await mixTest('title ', testTitle, 63, 2, true); // 加权 128
await mixTest('title ', testTitle, 63, 3, false); // 加权 129
await mixTest('title ', testTitle, 64, 1, false); // 加权 129
await mixTest('digest', testDigest, 119, 2, true); // 加权 240
await mixTest('digest', testDigest, 119, 3, false); // 加权 241
await mixTest('digest', testDigest, 120, 1, false); // 加权 241

line('');
line('========================================');
line('最终结论');
line('========================================');
line(`title : 纯 ASCII 上限 ${t.max}，首个报错长度 ${t.firstFail}`);
line(`digest: 纯 ASCII 上限 ${d.max}，首个报错长度 ${d.firstFail}`);

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
  const dd = await r.json();
  if (dd.errcode === 0 || dd.errcode === undefined) delOk++;
  await sleep(200);
}
line(`已删除 ${delOk}/${created.length} 条`);

const dmr = await fetch(`${API}/cgi-bin/material/del_material?access_token=${token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ media_id: thisMaterial }),
});
const dm = await dmr.json();
line(`本次测试封面素材删除: ${dm.errcode === 0 || dm.errcode === undefined ? '成功' : JSON.stringify(dm)}`);
line(`本次共调用 ${calls} 次 draft/add`);
line('注: 前两轮测试还上传过 2 张紫色封面图，需手动清理');
