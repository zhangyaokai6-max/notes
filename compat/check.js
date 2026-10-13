// 兼容性检查：把 compat/ 里各个版本导出的备份，逐个导入当前的 index.html，再导出，逐条核对有没有丢东西。
// 用法（在仓库根目录）：npm i playwright && npx playwright install chromium && node compat/check.js
// 每次发布新版本之前跑一遍；全部显示“完整”才能发布。发布后再用新版本导出一份样本放进来（见 README.md）。
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), HERE = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname), f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function compare(F, E){                                    // F 里的每一条、每个字段，E 里都得有，而且一样
  const lost = [], diff = []; let n = 0;
  for (const [k, v] of Object.entries(F)) {
    if (k === 'log' && v && typeof v === 'object') {
      for (const [d, arr] of Object.entries(v)) for (const x of arr) { n++; const y = ((E.log || {})[d] || []).find(z => z.id === x.id); if (!y) lost.push(`log/${d}/${x.id}`); else for (const f of Object.keys(x)) if (!same(x[f], y[f])) diff.push(`log/${d}/${x.id}.${f}`); }
      continue;
    }
    if (!Array.isArray(v)) continue;
    for (const x of v) {
      if (!x || x.sample) continue; n++;
      const y = (E[k] || []).find(z => z && z.id === x.id);
      if (!y) { lost.push(`${k}/${x.id}`); continue; }
      for (const f of Object.keys(x)) if (!same(x[f], y[f])) diff.push(`${k}/${x.id}.${f}：${String(JSON.stringify(x[f])).slice(0, 60)} → ${y[f] === undefined ? '（没有了）' : String(JSON.stringify(y[f])).slice(0, 60)}`);
    }
  }
  return { n, lost, diff };
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`, b = await chromium.launch();
  const roundTrip = async file => {                          // 新开一个干净的浏览器环境：导入 → 导出
    const ctx = await b.newContext({ acceptDownloads: true, serviceWorkers: 'block', locale: 'zh-CN' }), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(base); await p.waitForSelector('#archBtn');
    await p.setInputFiles('#importFile', file); await p.waitForTimeout(600);
    await p.click('#archBtn'); await p.waitForTimeout(200);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
    const out = fs.readFileSync(await dl.path(), 'utf8'); await ctx.close();
    return { out, errs };
  };
  const files = fs.readdirSync(HERE).filter(f => /^backup-.*\.json$/.test(f)).sort();
  let bad = 0;
  for (const f of files) {
    const src = path.join(HERE, f), F = JSON.parse(fs.readFileSync(src, 'utf8'));
    const r1 = await roundTrip(src), E = JSON.parse(r1.out), c = compare(F, E);
    const tmp = path.join(require('os').tmpdir(), 'compat-' + f); fs.writeFileSync(tmp, r1.out);
    const r2 = await roundTrip(tmp), E2 = JSON.parse(r2.out); delete E.savedAt; delete E2.savedAt;
    const stable = same(E, E2), ok = !c.lost.length && !c.diff.length && stable && !r1.errs.length && !r2.errs.length;
    if (!ok) bad++;
    console.log(`${ok ? '完整' : '有问题'}  ${f}：${c.n} 条${c.lost.length ? `，丢了 ${c.lost.length} 条` : ''}${c.diff.length ? `，${c.diff.length} 处字段变了` : ''}${stable ? '' : '，再导入一次结果不一样'}${r1.errs.length + r2.errs.length ? '，页面报错' : ''}`);
    for (const x of [...c.lost.map(s => '  丢失 ' + s), ...c.diff.map(s => '  变化 ' + s), ...r1.errs, ...r2.errs].slice(0, 30)) console.log(x);
  }
  await b.close(); server.close();
  console.log(bad ? `\n${bad} 份备份不兼容，先别发布。` : `\n全部 ${files.length} 份备份都能完整导入。`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
