// 微信公众号 API 连通性 + 草稿写入验证
// 用法: node wechat-check.mjs [凭证文件路径]
// 凭证文件格式: {"appid":"wx...","secret":"..."}

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const credPath = process.argv[2] || path.join(process.cwd(), '.workbuddy', 'wechat-cred.json');
const API = 'https://api.weixin.qq.com';

const line = (s) => console.log(s);

// ---------- CRC32（自带实现，不依赖 zlib.crc32 的版本可用性）----------
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

// 生成一张最小合法 PNG 作测试封面（900x383，微信推荐比例）
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

function mask(s) {
  if (!s) return '(空)';
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '***' + s.slice(-4);
}

async function getEgressIp() {
  const urls = ['https://4.ipw.cn/', 'https://myip.ipip.net/', 'https://api.ipify.org/'];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      const t = (await r.text()).trim();
      if (t) return { src: u, body: t.replace(/\s+/g, ' ').slice(0, 160) };
    } catch {
      /* 换下一个源 */
    }
  }
  return null;
}

async function callApi(p) {
  const r = await fetch(API + p, { signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errcode: -1, errmsg: 'non-json: ' + text.slice(0, 200) };
  }
}

// 注意: 微信接口成功时通常只返回结果字段，不带 errcode。
// 判定成功请看结果字段本身（media_id / url 等），不要用 errcode === 0。
function diagnose(code, stage) {
  const map = {
    48001: 'api unauthorized —— 该账号无此接口权限。个人主体订阅号最常见的死因。',
    40164: 'IP 不在白名单。去开发者平台「我的业务 → 公众号 → 开发密钥 → API IP白名单」添加。',
    61004: '未配置白名单 IP，或当前调用 IP 不在白名单中。',
    40243: 'AppSecret 被冻结，去开发者平台「开发密钥」解冻或重置。',
    40125: 'AppSecret 无效，需重置。',
    40013: 'AppID 无效，检查是否复制完整。',
    40007: 'invalid media_id —— 封面素材 ID 无效或缺失。',
    45003: '标题超长（上限 64 字节，中文 1 字 = 3 字节）。',
    45004: '摘要超长（上限 120 字节，中文 1 字 = 3 字节）。',
  };
  if (map[code]) line(`>> 判定: ${map[code]}`);
  else line(`>> 判定: 见上方错误码（阶段: ${stage}）。`);
}

// ---------- 1. 出口 IP ----------
line('=== 1. 出口 IP 探测 ===');
const ip = await getEgressIp();
line(ip ? `${ip.src} -> ${ip.body}` : '探测失败（不影响后续，微信会在报错里回显真实 IP）');

// ---------- 2. 凭证 ----------
line('');
line('=== 2. 读取凭证 ===');
if (!fs.existsSync(credPath)) {
  line(`凭证文件不存在: ${credPath}`);
  line('内容格式: {"appid":"wx****","secret":"****"}');
  process.exit(0);
}
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const appid = (cred.appid || cred.appId || '').trim();
const secret = (cred.secret || cred.appSecret || '').trim();
line(`appid : ${mask(appid)} (长度 ${appid.length})`);
line(`secret: ${mask(secret)} (长度 ${secret.length})`);
if (!appid || !secret) {
  line('appid 或 secret 为空，终止。');
  process.exit(1);
}

// ---------- 3. access_token ----------
line('');
line('=== 3. 换取 access_token ===');
const tok = await callApi(`/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`);
if (tok.errcode) {
  line(`失败  errcode=${tok.errcode}`);
  line(`      errmsg=${tok.errmsg}`);
  const ips = tok.errmsg.match(/(?:::ffff:)?\d{1,3}(?:\.\d{1,3}){3}/g) || [];
  if (tok.errcode === 40164 && ips.length) line(`      回显 IP: ${ips.join('  ')}`);
  diagnose(tok.errcode, 'token');
  process.exit(0);
}
const token = tok.access_token;
line(`成功   token=${mask(token)}  有效期 ${tok.expires_in}s`);

// ---------- 4. 上传封面素材 ----------
line('');
line('=== 4. 上传永久图片素材 material/add_material ===');
const png = makeCoverPng();
line(`本地生成测试封面 ${png.length} 字节 (PNG 900x383)`);
const boundary = '----wxcheck' + Date.now().toString(16);
const mpBody = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n`,
    'utf8'
  ),
  png,
  Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
]);
let thumbId = '';
try {
  const r = await fetch(`${API}/cgi-bin/material/add_material?access_token=${token}&type=image`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: mpBody,
    signal: AbortSignal.timeout(30000),
  });
  const rawText = await r.text();
  let m;
  try {
    m = JSON.parse(rawText);
  } catch {
    m = { errcode: 'NON-JSON', errmsg: rawText.slice(0, 400) };
  }
  if (m.media_id) {
    thumbId = m.media_id;
    line(`成功   media_id=${mask(thumbId)}`);
    if (m.url) line(`       url=${m.url.slice(0, 80)}...`);
  } else {
    line(`失败  errcode=${m.errcode}`);
    line(`      errmsg=${m.errmsg}`);
    line(`      HTTP ${r.status}  raw=${rawText.slice(0, 300)}`);
    diagnose(m.errcode, 'material');
  }
} catch (e) {
  line('请求异常: ' + e.message);
}

// ---------- 5. 新增草稿 ----------
line('');
line('=== 5. 新增草稿 draft/add ===');
const article = {
  title: 'API 连通性测试',
  author: 'test',
  digest: '可忽略，连通性测试',
  content: '<p>connectivity test</p>',
  content_source_url: '',
  need_open_comment: 0,
  only_fans_can_comment: 0,
};
if (thumbId) article.thumb_media_id = thumbId;

let draftOk = false;
try {
  const r = await fetch(`${API}/cgi-bin/draft/add?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles: [article] }),
    signal: AbortSignal.timeout(20000),
  });
  const rawText = await r.text();
  let d;
  try {
    d = JSON.parse(rawText);
  } catch {
    d = { errcode: 'NON-JSON', errmsg: rawText.slice(0, 300) };
  }
  if (d.media_id) {
    draftOk = true;
    line(`成功   media_id=${mask(d.media_id)}`);
  } else {
    line(`失败  errcode=${d.errcode}`);
    line(`      errmsg=${d.errmsg}`);
    line(`      HTTP ${r.status}  raw=${rawText.slice(0, 300)}`);
    diagnose(d.errcode, 'draft');
  }
} catch (e) {
  line('请求异常: ' + e.message);
}

// ---------- 结论 ----------
line('');
line('=== 结论 ===');
if (draftOk) {
  line('【接口可用】该账号能用 API 写入草稿箱。');
  line('后台草稿箱已出现测试草稿「API 连通性测试」，请手动删除。');
  line('永久素材库里多了一张紫色测试图（封面），也请一并删除。');
  line('注意: 个人主体订阅号无法调用发布接口 freepublish/submit，最后一步仍需手动点发布。');
} else if (thumbId) {
  line('封面素材上传成功，但草稿写入失败 —— 看上方第 5 步的错误码。');
} else {
  line('封面素材上传就没过 —— 草稿写入即使有权限也用不了，因为封面是硬性要求。');
}
