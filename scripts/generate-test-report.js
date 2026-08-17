#!/usr/bin/env node
/**
 * Sinh TEST_REPORT.md từ kết quả Jest.
 *
 * Đọc:
 *   test-results/{unit,int,e2e}.json  — output của `jest --json`
 *   coverage/coverage-summary.json    — output của coverageReporter 'json-summary'
 *
 * Không phụ thuộc thư viện ngoài để chạy được ở mọi môi trường CI.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'test-results');
const OUTPUT = path.join(ROOT, 'TEST_REPORT.md');

// Mục tiêu coverage theo kế hoạch kiểm thử — dùng để chấm ✅/⚠️/❌ từng vùng.
const COVERAGE_TARGETS = [
  { pattern: 'src/common/', label: 'Hàm dùng chung (enum, validator)', target: 95 },
  { pattern: 'src/auth/guards/', label: 'Guard phân quyền', target: 95 },
  { pattern: 'src/auth/strategies/', label: 'Chiến lược xác thực JWT', target: 95 },
  { pattern: 'src/auth/auth.service.ts', label: 'Dịch vụ xác thực', target: 85 },
  { pattern: 'src/sensor/sensor-buffer.service.ts', label: 'Đệm ghi telemetry', target: 90 },
  { pattern: 'src/sensor/vibration-window.service.ts', label: 'Cửa sổ trượt rung động', target: 95 },
  { pattern: 'src/sensor/sensor.service.ts', label: 'Dịch vụ cảm biến & cảnh báo', target: 80 },
  { pattern: 'src/sensor/sensor.controller.ts', label: 'Controller cảm biến', target: 75 },
  { pattern: 'src/gateway/', label: 'Gateway & WebSocket', target: 80 },
  { pattern: 'src/node/', label: 'Sensor Node', target: 80 },
  { pattern: 'src/camera/', label: 'Camera', target: 80 },
  { pattern: 'src/dam/', label: 'Đập & Trạm quan trắc', target: 80 },
  { pattern: 'src/evidence/', label: 'Ảnh bằng chứng', target: 70 },
  { pattern: 'src/audit-log/', label: 'Nhật ký hệ thống', target: 80 },
];

/** Rủi ro phát hiện trong quá trình đọc mã và viết test. */
const FINDINGS = [
  {
    level: 'Cao',
    title: 'GatewayApiKeyGuard mở toang khi chưa cấu hình khoá',
    where: 'src/auth/guards/gateway-api-key.guard.ts:16',
    detail:
      'Khi GATEWAY_API_KEY không được đặt (hoặc chỉ chứa khoảng trắng), guard trả true cho mọi request. ' +
      'Các endpoint ingest (POST /sensor/all, POST /api/evidence/upload, GET /api/gateway/:id/config) trở thành công khai hoàn toàn.',
    evidence: 'gateway-api-key.guard.spec.ts — "cho qua mọi request khi key ..."',
    fix: 'Chuyển sang fail-closed: thiếu cấu hình thì từ chối và ghi log cảnh báo lúc khởi động.',
  },
  {
    level: 'Trung bình',
    title: 'Telemetry bọc nháy JSON bị loại bỏ âm thầm',
    where: 'src/sensor/sensor.service.ts:1050',
    detail:
      'parseTelemetryPayload dùng JSON.parse trước, nên một chuỗi số trả về số trần thay vì { value }. ' +
      'ingestSingleTelemetry đọc payload.value/.waterLevel trên số trần đều ra undefined nên freshTypes rỗng — ' +
      'số đo không được ghi và không có lỗi nào được báo. ' +
      'PHẠM VI: kiểm chứng trên broker thật cho thấy payload số trần (99) đi qua bộ giải mã của Nest đã thành ' +
      'kiểu number nên vẫn chạy đúng; lỗi chỉ kích hoạt khi payload được bọc nháy JSON ("42") hoặc khi hàm ' +
      'được gọi trực tiếp với đối số kiểu chuỗi.',
    evidence:
      'mqtt.rt-spec.ts — "LỖI: payload bọc nháy JSON bị loại bỏ âm thầm" (broker thật); ' +
      'sensor.service.spec.ts — "chuỗi số hợp lệ trả về số trần".',
    fix: 'Sau JSON.parse, nếu kết quả là số hoặc chuỗi thì bọc lại thành { value }.',
  },
  {
    level: 'Cao',
    title: 'Mọi handler MQTT nuốt lỗi, không có tín hiệu vận hành',
    where: 'src/sensor/sensor.controller.ts:199',
    detail:
      'Cả 5 @MessagePattern đều bắt lỗi và trả { ok: false }. Microservice không chết, nhưng dữ liệu quan trắc mất mà không ai biết.',
    evidence: 'sensor.controller.spec.ts — "lỗi từ service bị nuốt"',
    fix: 'Giữ cơ chế nuốt lỗi nhưng bổ sung đếm số lần lỗi và cảnh báo khi vượt ngưỡng.',
  },
  {
    level: 'Trung bình',
    title: 'API key chấp nhận qua query string',
    where: 'src/auth/guards/gateway-api-key.guard.ts:23',
    detail:
      'Khoá được đọc từ query.apiKey ngoài header. Query string bị ghi vào access log của reverse proxy và lịch sử trình duyệt.',
    evidence: 'gateway-api-key.guard.spec.ts — "chấp nhận key qua query string"',
    fix: 'Chỉ chấp nhận qua header x-gateway-api-key.',
  },
  {
    level: 'Trung bình',
    title: 'ThresholdConfig.sustainedSeconds sửa được nhưng không có tác dụng',
    where: 'src/sensor/sensor.service.ts:729',
    detail:
      'Thời gian duy trì trước khi sinh cảnh báo luôn dùng hằng số 30 giây, bỏ qua giá trị sustainedSeconds mà người dùng cấu hình qua API.',
    evidence: 'sensor.service.spec.ts — "bỏ qua sustainedSeconds của cấu hình"',
    fix: 'Dùng config.sustainedSeconds khi có, lấy 30 giây làm mặc định.',
  },
  {
    level: 'Trung bình',
    title: 'OPERATOR chưa gán đập được đẩy về DAM-001 cứng',
    where: 'src/sensor/sensor.controller.ts:329,357,430',
    detail:
      'Khi assignedDamId rỗng, controller gán cứng "DAM-001" thay vì từ chối — người dùng thấy dữ liệu của một đập không thuộc phạm vi của mình.',
    evidence: 'sensor.controller.spec.ts — "OPERATOR chưa gán đập bị đẩy về DAM-001 cứng"',
    fix: 'Trả 403 khi OPERATOR chưa được phân công đập.',
  },
  {
    level: 'Trung bình',
    title: 'CameraController và EvidenceController không thu hẹp theo đập',
    where: 'src/camera/camera.controller.ts, src/evidence/evidence.controller.ts',
    detail:
      'Hai controller này chỉ kiểm tra @Roles, không kiểm assignedDamId như Dam/Gateway/Node — OPERATOR đọc và sửa được camera, ảnh bằng chứng của mọi đập.',
    evidence:
      'authz.e2e-spec.ts — "LỖ HỔNG: OPERATOR thấy camera của mọi đập" và "sửa được camera của đập khác" (xác nhận qua HTTP thật).',
    fix: 'Áp cùng mẫu kiểm tra assignedDamId, hoặc tách thành một guard dùng chung.',
  },
  {
    level: 'Trung bình',
    title: 'GatewayController.findById thiếu kiểm tra phạm vi đập',
    where: 'src/gateway/gateway.controller.ts:48',
    detail:
      'findAll, create, update và delete đều kiểm assignedDamId, riêng findById thì không. ' +
      'OPERATOR biết mã gateway là đọc được cấu hình gateway thuộc đập khác.',
    evidence:
      'authz.e2e-spec.ts — "LỖ HỔNG: OPERATOR đọc được gateway của đập khác qua :id"; gateway.controller.spec.ts.',
    fix: 'Thêm kiểm tra assignedDamId giống ba method còn lại trong cùng controller.',
  },
  {
    level: 'Trung bình',
    title: 'Bỏ qua kiểm tra định dạng khi thiếu Content-Type',
    where: 'src/evidence/evidence.controller.ts:59',
    detail:
      'Điều kiện lọc là `file.mimetype && !mimetype.startsWith("image/")`, nên client không gửi ' +
      'Content-Type sẽ tải được tệp bất kỳ lên MinIO qua endpoint công khai.',
    evidence: 'evidence.controller.spec.ts — "LỖ HỔNG: thiếu mimetype thì bỏ qua kiểm tra định dạng".',
    fix: 'Coi mimetype vắng mặt là không hợp lệ, hoặc kiểm tra chữ ký byte đầu tệp.',
  },
  {
    level: 'Trung bình',
    title: 'WebSocket không xác thực',
    where: 'src/gateway/sensor.gateway.ts:11',
    detail:
      'SensorGateway đặt cors.origin "*" và không kiểm JWT. Bất kỳ ai biết địa chỉ đều nhận được toàn bộ telemetry và cảnh báo realtime của mọi đập.',
    evidence: 'sensor.gateway.spec.ts — các test phát sóng đều không qua bước xác thực nào.',
    fix: 'Kiểm token trong handleConnection và chia phòng theo damId.',
  },
  {
    level: 'Trung bình',
    title: 'GatewayService rò rỉ kết nối MQTT khi tắt ứng dụng',
    where: 'src/gateway/gateway.service.ts:41',
    detail:
      'onModuleInit mở một kết nối MQTT riêng (ngoài microservice của Nest) nhưng lớp này không ' +
      'cài OnModuleDestroy, nên client không bao giờ được đóng. Hệ quả: app.close() không giải phóng ' +
      'được tài nguyên, tiến trình Node không thoát — triển khai thật sẽ treo khi khởi động lại ' +
      'hoặc khi container nhận tín hiệu dừng, buộc phải kill cứng.',
    evidence:
      'Phát hiện qua tầng realtime: Jest không thoát sau khi test xong; thêm bước đóng client thủ ' +
      'công trong teardownRealtimeApp() thì tiến trình thoát sạch ngay (mã thoát 0).',
    fix: 'Cài OnModuleDestroy cho GatewayService và gọi this.mqttClient?.end(true) trong đó.',
  },
  {
    level: 'Thấp',
    title: 'JwtAuthGuard có Reflector tuỳ chọn — @Public im lặng ngừng hoạt động',
    where: 'src/auth/guards/jwt-auth.guard.ts:8',
    detail:
      'Constructor khai reflector?: Reflector. Nếu guard được khởi tạo thủ công không qua DI, nhánh kiểm tra @Public bị bỏ qua mà không báo lỗi.',
    evidence: 'jwt-auth.guard.spec.ts — "KHÔNG có Reflector → @Public() ngừng hoạt động"',
    fix: 'Bỏ dấu ? để thiếu Reflector là lỗi khởi tạo ngay lập tức.',
  },
  {
    level: 'Thấp',
    title: 'EvidenceService ghi bản ghi kể cả khi tải ảnh lên MinIO thất bại',
    where: 'src/evidence/evidence.service.ts',
    detail:
      'Lỗi putObject chỉ được console.error, hàng vẫn được lưu vào DB — sinh ra imageUrl trỏ tới đối tượng không tồn tại.',
    evidence:
      'evidence.service.spec.ts — "putObject thất bại nhưng bản ghi vẫn được lưu (sinh imageUrl mồ côi)".',
    fix: 'Đánh dấu trạng thái upload trong bản ghi, hoặc không lưu khi tải lên thất bại.',
  },
  {
    level: 'Thấp',
    title: 'Cookie sống lâu hơn token',
    where: 'src/auth/auth.controller.ts',
    detail:
      'Cookie access_token đặt maxAge 7 ngày trong khi JWT chỉ có hiệu lực 1 ngày. Sau ngày đầu, ' +
      'trình duyệt vẫn gửi cookie nhưng mọi request đều 401 — người dùng thấy như bị đăng xuất ngẫu nhiên.',
    evidence:
      'auth.controller.spec.ts — "LỖ HỔNG: cookie hết hạn sau 7 ngày nhưng token chỉ sống 1 ngày".',
    fix: 'Đồng bộ maxAge của cookie với expiresIn của token.',
  },
  {
    level: 'Thấp',
    title: 'vibration-window.service.ts không được đăng ký ở module nào',
    where: 'src/sensor/vibration-window.service.ts',
    detail:
      'Service chứa logic cửa sổ trượt đầy đủ nhưng không nằm trong providers của SensorModule nên không bao giờ được dùng.',
    evidence: 'vibration-window.service.spec.ts — 20 test chạy được nhưng trên mã chết.',
    fix: 'Quyết định đưa vào SensorModule để dùng, hoặc xoá hẳn.',
  },
];

// ── Đọc dữ liệu ──

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return 'không xác định';
  }
}

const SUITES = [
  { key: 'unit', label: 'Unit test', file: 'unit.json' },
  { key: 'int', label: 'Integration test', file: 'int.json' },
  { key: 'e2e', label: 'E2E test', file: 'e2e.json' },
  { key: 'rt', label: 'Realtime test (MQTT & WebSocket)', file: 'rt.json' },
];

/** Suy ra tên module từ đường dẫn file spec. */
function moduleOf(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const m = norm.match(/\/src\/([^/]+)\//);
  if (m) return m[1];
  if (norm.includes('/test/integration/')) return 'integration';
  if (norm.includes('/test/realtime/')) return 'realtime';
  if (norm.includes('/test/')) return 'e2e';
  return 'khác';
}

function relPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

// ── Định dạng ──

const fmt = (n) => (n == null ? '—' : `${n.toFixed(1)}%`);
const ms = (n) => (n == null ? '—' : n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

function statusIcon(actual, target) {
  if (actual == null) return '❌';
  if (actual >= target) return '✅';
  if (actual >= target * 0.6) return '⚠️';
  return '❌';
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  return [head, sep, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

// ── Dựng báo cáo ──

function buildReport() {
  const suites = SUITES.map((s) => ({
    ...s,
    data: readJson(path.join(RESULTS_DIR, s.file)),
  })).filter((s) => s.data);

  if (suites.length === 0) {
    console.error(
      'Không tìm thấy kết quả test nào trong test-results/. Chạy `npm run test:report` để sinh.',
    );
    process.exit(1);
  }

  const coverage = readJson(path.join(ROOT, 'coverage', 'coverage-summary.json'));
  const out = [];

  const total = suites.reduce(
    (acc, s) => ({
      tests: acc.tests + s.data.numTotalTests,
      passed: acc.passed + s.data.numPassedTests,
      failed: acc.failed + s.data.numFailedTests,
      pending: acc.pending + s.data.numPendingTests,
      suites: acc.suites + s.data.numTotalTestSuites,
    }),
    { tests: 0, passed: 0, failed: 0, pending: 0, suites: 0 },
  );
  // Output của `jest --json` chỉ có startTime ở cấp tổng; thời điểm kết thúc phải
  // suy từ perfStats của từng bộ test.
  const suiteDuration = (data) => {
    const ends = data.testResults.map((tr) => tr.perfStats?.end ?? tr.endTime ?? 0);
    const end = Math.max(0, ...ends);
    return end > data.startTime ? end - data.startTime : null;
  };
  const duration = suites.reduce((a, s) => a + (suiteDuration(s.data) ?? 0), 0);

  // ── 1. Tổng quan ──
  out.push('# Báo cáo Kiểm thử — Hệ thống Giám sát Đập Thủy điện');
  out.push('');
  out.push(`> Backend NestJS · Sinh tự động bởi \`scripts/generate-test-report.js\``);
  out.push('');
  out.push('## 1. Tổng quan');
  out.push('');
  out.push(
    table(
      ['Hạng mục', 'Giá trị'],
      [
        ['Ngày chạy', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })],
        ['Commit', `\`${gitCommit()}\``],
        ['Node.js', process.version],
        ['Tổng số test', `**${total.tests}**`],
        ['Đạt', `**${total.passed}**`],
        ['Không đạt', total.failed > 0 ? `**${total.failed}**` : '0'],
        ['Bỏ qua', String(total.pending)],
        ['Số bộ test', String(total.suites)],
        ['Tổng thời gian', ms(duration)],
        [
          'Kết luận',
          total.failed === 0 ? '✅ Toàn bộ test đạt' : `❌ Có ${total.failed} test không đạt`,
        ],
      ],
    ),
  );
  out.push('');
  out.push('### Theo tầng kiểm thử');
  out.push('');
  out.push(
    table(
      ['Tầng', 'Số test', 'Đạt', 'Không đạt', 'Thời gian', 'Trạng thái'],
      suites.map((s) => [
        s.label,
        String(s.data.numTotalTests),
        String(s.data.numPassedTests),
        String(s.data.numFailedTests),
        ms(suiteDuration(s.data)),
        s.data.numFailedTests === 0 ? '✅' : '❌',
      ]),
    ),
  );
  out.push('');

  const missing = SUITES.filter((s) => !suites.find((x) => x.key === s.key));
  if (missing.length) {
    out.push(
      `> ⚠️ Chưa có kết quả cho: ${missing
        .map((m) => m.label)
        .join(', ')}. Các tầng này cần hạ tầng Docker (\`npm run test:infra:up\`).`,
    );
    out.push('');
  }

  // ── 2. Kết quả theo module ──
  const byModule = new Map();
  for (const s of suites) {
    for (const tr of s.data.testResults) {
      const mod = moduleOf(tr.name);
      const entry = byModule.get(mod) || { total: 0, passed: 0, failed: 0, files: new Set() };
      entry.files.add(relPath(tr.name));
      for (const a of tr.assertionResults) {
        entry.total++;
        if (a.status === 'passed') entry.passed++;
        else if (a.status === 'failed') entry.failed++;
      }
      byModule.set(mod, entry);
    }
  }

  out.push('## 2. Kết quả theo module');
  out.push('');
  out.push(
    table(
      ['Module', 'Số file spec', 'Số test', 'Đạt', 'Không đạt', 'Trạng thái'],
      [...byModule.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([mod, e]) => [
          `\`${mod}\``,
          String(e.files.size),
          String(e.total),
          String(e.passed),
          String(e.failed),
          e.failed === 0 ? '✅' : '❌',
        ]),
    ),
  );
  out.push('');

  // ── 3. Bảng test case chi tiết ──
  out.push('## 3. Danh sách test case chi tiết');
  out.push('');
  let idx = 0;
  for (const s of suites) {
    for (const tr of [...s.data.testResults].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`### \`${relPath(tr.name)}\``);
      out.push('');
      const rows = tr.assertionResults.map((a) => {
        idx++;
        const icon = a.status === 'passed' ? '✅' : a.status === 'failed' ? '❌' : '⏭️';
        const group = a.ancestorTitles.slice(1).join(' › ');
        return [
          `TC-${String(idx).padStart(3, '0')}`,
          group ? `${group} › ${a.title}` : a.title,
          icon,
          ms(a.duration),
        ];
      });
      out.push(table(['Mã', 'Tên test case', 'Kết quả', 'Thời gian'], rows));
      out.push('');
    }
  }

  // ── 4. Test không đạt ──
  out.push('## 4. Test không đạt');
  out.push('');
  const failures = [];
  for (const s of suites) {
    for (const tr of s.data.testResults) {
      for (const a of tr.assertionResults) {
        if (a.status === 'failed') {
          failures.push({ file: relPath(tr.name), a });
        }
      }
    }
  }
  if (failures.length === 0) {
    out.push('Không có test nào thất bại.');
  } else {
    for (const f of failures) {
      out.push(`### ❌ ${[...f.a.ancestorTitles, f.a.title].join(' › ')}`);
      out.push('');
      out.push(`**File:** \`${f.file}\``);
      out.push('');
      out.push('```');
      out.push((f.a.failureMessages || []).join('\n').split('\n').slice(0, 15).join('\n'));
      out.push('```');
      out.push('');
    }
  }
  out.push('');

  // ── 5. Coverage ──
  out.push('## 5. Độ bao phủ mã nguồn');
  out.push('');
  if (!coverage) {
    out.push('Chưa có dữ liệu coverage. Chạy lại với cờ `--coverage`.');
  } else {
    const t = coverage.total;
    out.push(
      table(
        ['Chỉ số', 'Tỷ lệ', 'Đã bao phủ / Tổng'],
        [
          ['Câu lệnh (statements)', fmt(t.statements.pct), `${t.statements.covered}/${t.statements.total}`],
          ['Nhánh (branches)', fmt(t.branches.pct), `${t.branches.covered}/${t.branches.total}`],
          ['Hàm (functions)', fmt(t.functions.pct), `${t.functions.covered}/${t.functions.total}`],
          ['Dòng (lines)', fmt(t.lines.pct), `${t.lines.covered}/${t.lines.total}`],
        ],
      ),
    );
    out.push('');

    out.push('### Đối chiếu với mục tiêu theo vùng');
    out.push('');
    const fileEntries = Object.entries(coverage).filter(([k]) => k !== 'total');
    const targetRows = COVERAGE_TARGETS.map((tgt) => {
      const matched = fileEntries.filter(([file]) =>
        relPath(file).startsWith(tgt.pattern),
      );
      if (matched.length === 0) return [tgt.label, `\`${tgt.pattern}\``, `${tgt.target}%`, '—', '❌'];
      const covered = matched.reduce((a, [, v]) => a + v.statements.covered, 0);
      const totalSt = matched.reduce((a, [, v]) => a + v.statements.total, 0);
      const pct = totalSt ? (covered / totalSt) * 100 : 0;
      return [
        tgt.label,
        `\`${tgt.pattern}\``,
        `${tgt.target}%`,
        fmt(pct),
        statusIcon(pct, tgt.target),
      ];
    });
    out.push(table(['Vùng', 'Đường dẫn', 'Mục tiêu', 'Thực tế', 'Đạt'], targetRows));
    out.push('');

    out.push('### Chi tiết theo file (sắp xếp tăng dần — vùng yếu hiện lên trước)');
    out.push('');
    const fileRows = fileEntries
      .map(([file, v]) => ({
        file: relPath(file),
        st: v.statements.pct,
        br: v.branches.pct,
        fn: v.functions.pct,
        ln: v.lines.pct,
      }))
      .sort((a, b) => a.st - b.st)
      .map((r) => [
        `\`${r.file}\``,
        fmt(r.st),
        fmt(r.br),
        fmt(r.fn),
        fmt(r.ln),
      ]);
    out.push(table(['File', 'Câu lệnh', 'Nhánh', 'Hàm', 'Dòng'], fileRows));
  }
  out.push('');

  // ── 6. Lỗ hổng & rủi ro ──
  out.push('## 6. Lỗ hổng và rủi ro phát hiện');
  out.push('');
  out.push(
    'Các vấn đề dưới đây được phát hiện trong quá trình đọc mã và viết test. ' +
      'Nguyên tắc áp dụng: **test khẳng định hành vi hiện tại**, không tự ý sửa mã nguồn — ' +
      'nhờ đó mọi thay đổi sau này đều là quyết định có ý thức và được test bắt lại ngay.',
  );
  out.push('');
  const order = { Cao: 0, 'Trung bình': 1, Thấp: 2 };
  const icons = { Cao: '🔴', 'Trung bình': '🟠', Thấp: '🟡' };
  const sorted = [...FINDINGS].sort((a, b) => order[a.level] - order[b.level]);

  out.push(
    table(
      ['#', 'Mức độ', 'Vấn đề', 'Vị trí'],
      sorted.map((f, i) => [
        String(i + 1),
        `${icons[f.level]} ${f.level}`,
        f.title,
        `\`${f.where}\``,
      ]),
    ),
  );
  out.push('');

  sorted.forEach((f, i) => {
    out.push(`### ${i + 1}. ${icons[f.level]} ${f.title}`);
    out.push('');
    out.push(`- **Mức độ:** ${f.level}`);
    out.push(`- **Vị trí:** \`${f.where}\``);
    out.push(`- **Mô tả:** ${f.detail}`);
    out.push(`- **Bằng chứng:** ${f.evidence}`);
    out.push(`- **Khuyến nghị:** ${f.fix}`);
    out.push('');
  });

  // ── 7. Khuyến nghị ──
  out.push('## 7. Khuyến nghị tiếp theo');
  out.push('');
  const weak = coverage
    ? Object.entries(coverage)
        .filter(([k]) => k !== 'total')
        .filter(([, v]) => v.statements.pct < 50)
        .map(([f]) => relPath(f))
    : [];
  out.push('**Ưu tiên cao**');
  out.push('');
  out.push('1. Xử lý 3 vấn đề mức Cao ở mục 6 — đặc biệt là mất dữ liệu telemetry âm thầm.');
  out.push('2. Bổ sung phân quyền theo đập cho `CameraController` và `EvidenceController`.');
  if (weak.length) {
    out.push(`3. Nâng độ bao phủ cho ${weak.length} file đang dưới 50%:`);
    weak.slice(0, 12).forEach((f) => out.push(`   - \`${f}\``));
  }
  out.push('');
  out.push('**Ưu tiên trung bình**');
  out.push('');
  out.push('- Dựng hạ tầng Docker và chạy tầng integration + e2e (`npm run test:infra:up`).');
  out.push('- Thêm workflow GitHub Actions để chạy unit test trên mọi pull request.');
  out.push('- Đặt `coverageThreshold` trong `jest.config.js` để coverage tụt là fail build.');
  out.push('');

  // ── 8. Phụ lục ──
  out.push('## 8. Phụ lục — Cách tái lập kết quả');
  out.push('');
  out.push('```bash');
  out.push('npm ci');
  out.push('npm run test:unit -- --coverage   # không cần hạ tầng ngoài');
  out.push('npm run test:infra:up             # dựng Postgres/TimescaleDB + Mosquitto cho test');
  out.push('npm run test:int');
  out.push('npm run test:e2e');
  out.push('npm run test:rt                   # MQTT & WebSocket với hạ tầng thật');
  out.push('npm run test:report               # sinh lại chính file này + bản Word');
  out.push('```');
  out.push('');
  out.push('**Cấu hình môi trường test:** `.env.test` (giá trị giả, commit cùng mã nguồn).');
  out.push('');
  out.push(
    table(
      ['Thành phần', 'Cổng dev', 'Cổng test'],
      [
        ['PostgreSQL / TimescaleDB', '5432', '5433'],
        ['MQTT (Mosquitto)', '1883', '1884'],
        ['MinIO', '9000', 'mock ở cấp module'],
      ],
    ),
  );
  out.push('');
  out.push(
    '**Quy ước đặt tên file test:** `*.spec.ts` (unit, cạnh file nguồn) · ' +
      '`*.int-spec.ts` (integration, trong `test/integration/`) · ' +
      '`*.e2e-spec.ts` (e2e, trong `test/`) · ' +
      '`*.rt-spec.ts` (realtime, trong `test/realtime/`).',
  );
  out.push('');
  out.push(
    '> Tầng realtime dùng file setup riêng (`test/setup-realtime.ts`) KHÔNG giả lập gói `mqtt`, ' +
      'vì mục đích của tầng này chính là kiểm chứng đường truyền thật qua broker.',
  );
  out.push('');

  return out.join('\n');
}

// Bản DOCX dùng lại đúng nguồn dữ liệu này (xem generate-docx-report.js) để hai
// định dạng không bao giờ lệch số liệu nhau.
module.exports = {
  ROOT,
  RESULTS_DIR,
  SUITES,
  COVERAGE_TARGETS,
  FINDINGS,
  readJson,
  gitCommit,
  moduleOf,
  relPath,
};

if (require.main === module) {
  fs.writeFileSync(OUTPUT, buildReport(), 'utf8');
  console.log(`Đã sinh báo cáo: ${path.relative(process.cwd(), OUTPUT)}`);
}
