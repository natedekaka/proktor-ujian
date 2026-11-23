'use strict';
// Simple load test: simulate N siswa membuat sesi ujian.
// Usage: node tools/loadtest.js <baseUrl> <examCode> <count> <concurrency>
const [,, baseUrl = 'http://localhost:9340', examCode = 'GDH5DN', count = '100', conc = '20'] = process.argv;
const total = parseInt(count, 10);
const concurrency = parseInt(conc, 10);

async function one(i) {
  const t0 = Date.now();
  try {
    const res = await fetch(baseUrl + '/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_code: examCode, nis: 'N' + i, name: 'Siswa ' + i, kelas: 'X-1' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    // heartbeat
    await fetch(baseUrl + '/api/sessions/' + data.session_id + '/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    // finish
    await fetch(baseUrl + '/api/sessions/' + data.session_id + '/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'manual' }) });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: e.message };
  }
}

async function run() {
  console.log(`Load test: ${total} siswa, concurrency ${concurrency}, target ${baseUrl}`);
  const results = [];
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results.push(await one(i));
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const ok = results.filter(r => r.ok).length;
  const fail = results.length - ok;
  const times = results.filter(r=>r.ok).map(r=>r.ms).sort((a,b)=>a-b);
  const p50 = times[Math.floor(times.length*0.5)] || 0;
  const p95 = times[Math.floor(times.length*0.95)] || 0;
  const p99 = times[Math.floor(times.length*0.99)] || 0;
  const max = times[times.length-1] || 0;
  console.log(`OK: ${ok}  FAIL: ${fail}`);
  console.log(`Latency ms -> p50: ${p50}  p95: ${p95}  p99: ${p99}  max: ${max}`);
  if (fail) {
    const errs = {};
    results.filter(r=>!r.ok).forEach(r => { errs[r.err] = (errs[r.err]||0)+1; });
    console.log('Errors:', errs);
  }
}

run();
