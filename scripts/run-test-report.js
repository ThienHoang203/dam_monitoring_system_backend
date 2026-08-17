#!/usr/bin/env node
/**
 * Chạy các tầng test rồi sinh TEST_REPORT.md.
 *
 * Cố ý KHÔNG dừng khi một tầng thất bại: báo cáo có test đỏ mới là báo cáo có giá trị.
 * Tầng integration/e2e tự bỏ qua nếu hạ tầng Docker chưa chạy.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(ROOT, 'test-results');
fs.mkdirSync(RESULTS, { recursive: true });

// Gọi thẳng entry point của Jest bằng node, KHÔNG qua shell: đường dẫn dự án có
// thể chứa dấu cách (vd "Máy tính") và shell sẽ cắt sai tham số --outputFile.
const JEST_BIN = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');

function run(label, args) {
  console.log(`\n──── ${label} ────`);
  const res = spawnSync(process.execPath, [JEST_BIN, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return res.status === 0;
}

/** Kiểm tra nhanh xem một cổng TCP có ai lắng nghe không. */
function portOpen(port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

(async () => {
  run('Unit test', ['--coverage', '--json', '--outputFile=test-results/unit.json']);

  const dbUp = await portOpen(Number(process.env.DB_PORT) || 5433);
  if (dbUp) {
    run('Integration test', [
      '--config',
      './test/jest-integration.json',
      '--runInBand',
      '--json',
      '--outputFile=test-results/int.json',
    ]);
    run('E2E test', [
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      '--json',
      '--outputFile=test-results/e2e.json',
    ]);

    // Tầng realtime cần thêm broker MQTT, không chỉ cơ sở dữ liệu.
    const mqttUp = await portOpen(1884);
    if (mqttUp) {
      run('Realtime test (MQTT & WebSocket)', [
        '--config',
        './test/jest-realtime.json',
        '--runInBand',
        '--json',
        '--outputFile=test-results/rt.json',
      ]);
    } else {
      console.log('\n⚠️  Bỏ qua tầng realtime: không thấy broker MQTT ở cổng 1884.');
      const p = path.join(RESULTS, 'rt.json');
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } else {
    console.log(
      '\n⚠️  Bỏ qua tầng integration/e2e: không thấy PostgreSQL ở cổng 5433.\n' +
        '    Chạy `npm run test:infra:up` trước nếu muốn có đủ cả 3 tầng trong báo cáo.',
    );
    // Xoá kết quả cũ để báo cáo không hiển thị số liệu lỗi thời.
    for (const f of ['int.json', 'e2e.json', 'rt.json']) {
      const p = path.join(RESULTS, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  console.log('\n──── Sinh báo cáo ────');
  spawnSync(process.execPath, [path.join(__dirname, 'generate-test-report.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // Bản Word là tuỳ chọn: gói `docx` không nằm trong dependencies nên chỉ sinh khi có sẵn.
  try {
    require.resolve('docx');
    spawnSync(process.execPath, [path.join(__dirname, 'generate-docx-report.js')], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch {
    console.log(
      'Bỏ qua bản Word: chưa cài gói `docx`. Chạy `npm i -D docx` rồi `npm run test:report:docx`.',
    );
  }
})();
