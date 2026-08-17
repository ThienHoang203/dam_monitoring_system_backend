#!/usr/bin/env node
/**
 * Sinh BAO_CAO_KIEM_THU.docx — bản Word của báo cáo kiểm thử, định dạng phù hợp
 * để đưa vào báo cáo đồ án.
 *
 * Dùng lại đúng nguồn dữ liệu của generate-test-report.js (test-results/*.json +
 * coverage/coverage-summary.json) nên hai định dạng không bao giờ lệch số liệu.
 */
const fs = require('fs');
const path = require('path');
const {
  ROOT,
  RESULTS_DIR,
  SUITES,
  COVERAGE_TARGETS,
  FINDINGS,
  readJson,
  gitCommit,
  moduleOf,
  relPath,
} = require('./generate-test-report');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  ShadingType,
  BorderStyle,
  PageBreak,
  TableOfContents,
  Header,
  Footer,
  PageNumber,
  LevelFormat,
  convertInchesToTwip,
} = require('docx');

const OUTPUT = path.join(ROOT, 'BAO_CAO_KIEM_THU.docx');

// A4 (11906 DXA) trừ lề 1 inch mỗi bên.
const CONTENT_WIDTH = 11906 - 2 * convertInchesToTwip(1);

const COLORS = {
  heading: '1F3864',
  headerFill: 'D9E2F3',
  zebraFill: 'F2F5FB',
  ok: '1E7B34',
  warn: 'B26B00',
  fail: 'B02418',
  muted: '595959',
};

// ── Tiện ích dựng nội dung ──

const text = (value, opts = {}) => new TextRun({ text: String(value ?? ''), ...opts });

const para = (value, opts = {}) =>
  new Paragraph({
    children: Array.isArray(value) ? value : [text(value, opts.run || {})],
    spacing: { after: 120, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    heading: opts.heading,
    numbering: opts.numbering,
    border: opts.border,
  });

const bullet = (value) =>
  new Paragraph({
    children: [text(value)],
    numbering: { reference: 'bullet-list', level: 0 },
    spacing: { after: 80 },
  });

/**
 * Bảng Word chuẩn: phải đặt columnWidths ở table VÀ width ở từng ô, cùng đơn vị DXA
 * (PERCENTAGE vỡ khi mở bằng Google Docs).
 */
function makeTable(headers, rows, weights) {
  const w = weights || headers.map(() => 1);
  const totalWeight = w.reduce((a, b) => a + b, 0);
  const columnWidths = w.map((x) => Math.floor((x / totalWeight) * CONTENT_WIDTH));
  // Bù phần dư cho cột cuối để tổng khớp đúng bề rộng bảng.
  columnWidths[columnWidths.length - 1] +=
    CONTENT_WIDTH - columnWidths.reduce((a, b) => a + b, 0);

  const cell = (content, i, opts = {}) =>
    new TableCell({
      width: { size: columnWidths[i], type: WidthType.DXA },
      shading: opts.fill
        ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' }
        : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [
        new Paragraph({
          spacing: { after: 0 },
          children: [
            text(content, { bold: opts.bold, color: opts.color, size: 19 }),
          ],
        }),
      ],
    });

  return new Table({
    columnWidths,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          cell(h, i, { bold: true, fill: COLORS.headerFill }),
        ),
      }),
      ...rows.map(
        (row, rowIndex) =>
          new TableRow({
            children: row.map((c, i) => {
              const value = typeof c === 'object' && c !== null ? c.text : c;
              const color = typeof c === 'object' && c !== null ? c.color : undefined;
              return cell(value, i, {
                fill: rowIndex % 2 === 1 ? COLORS.zebraFill : undefined,
                color,
              });
            }),
          }),
      ),
    ],
  });
}

const spacer = () => new Paragraph({ text: '', spacing: { after: 160 } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const fmtPct = (n) => (n == null ? '—' : `${n.toFixed(1)}%`);
const fmtMs = (n) => (n == null ? '—' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

// ── Đọc dữ liệu ──

const suites = SUITES.map((s) => ({ ...s, data: readJson(path.join(RESULTS_DIR, s.file)) })).filter(
  (s) => s.data,
);

if (suites.length === 0) {
  console.error('Không tìm thấy kết quả test. Chạy `npm run test:report` trước.');
  process.exit(1);
}

const coverage = readJson(path.join(ROOT, 'coverage', 'coverage-summary.json'));

const suiteDuration = (data) => {
  const ends = data.testResults.map((tr) => tr.perfStats?.end ?? tr.endTime ?? 0);
  const end = Math.max(0, ...ends);
  return end > data.startTime ? end - data.startTime : null;
};

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
const duration = suites.reduce((a, s) => a + (suiteDuration(s.data) ?? 0), 0);

const today = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dựng tài liệu ──

const children = [];

// Trang bìa
children.push(
  new Paragraph({ text: '', spacing: { after: 2400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [text('BÁO CÁO KIỂM THỬ PHẦN MỀM', { bold: true, size: 40, color: COLORS.heading })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [
      text('Hệ thống Giám sát An toàn Đập Thủy điện', { size: 30, color: COLORS.heading }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [text('Thành phần: Backend (NestJS + TypeORM + MQTT)', { size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 1200 },
    children: [
      text(`Phạm vi: Unit · Integration · End-to-End`, { size: 24, color: COLORS.muted }),
    ],
  }),
);

children.push(
  makeTable(
    ['Hạng mục', 'Nội dung'],
    [
      ['Ngày thực hiện', today],
      ['Phiên bản mã nguồn', gitCommit()],
      ['Môi trường', `Node.js ${process.version}`],
      ['Tổng số ca kiểm thử', String(total.tests)],
      [
        'Kết quả',
        total.failed === 0
          ? { text: `Đạt toàn bộ ${total.passed}/${total.tests}`, color: COLORS.ok }
          : { text: `${total.failed} ca không đạt`, color: COLORS.fail },
      ],
    ],
    [1, 2],
  ),
);

children.push(pageBreak());

// Mục lục
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text('Mục lục')] }),
  new TableOfContents('Mục lục', { hyperlink: true, headingStyleRange: '1-2' }),
  pageBreak(),
);

// 1. Tổng quan
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text('1. Tổng quan')] }));
children.push(
  para(
    `Báo cáo tổng hợp kết quả kiểm thử tự động cho backend hệ thống giám sát đập thủy điện. ` +
      `Bộ kiểm thử gồm ${total.tests} ca chia thành ${suites.length} tầng, chạy trong ${fmtMs(duration)}.`,
  ),
);
children.push(
  makeTable(
    ['Chỉ số', 'Giá trị'],
    [
      ['Tổng số ca kiểm thử', String(total.tests)],
      ['Đạt', { text: String(total.passed), color: COLORS.ok }],
      [
        'Không đạt',
        total.failed > 0
          ? { text: String(total.failed), color: COLORS.fail }
          : { text: '0', color: COLORS.ok },
      ],
      ['Bỏ qua', String(total.pending)],
      ['Số bộ kiểm thử', String(total.suites)],
      ['Tổng thời gian chạy', fmtMs(duration)],
    ],
    [2, 1],
  ),
);
children.push(spacer());

children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('1.1. Kết quả theo tầng')] }),
);
children.push(
  makeTable(
    ['Tầng kiểm thử', 'Số ca', 'Đạt', 'Không đạt', 'Thời gian'],
    suites.map((s) => [
      s.label,
      String(s.data.numTotalTests),
      { text: String(s.data.numPassedTests), color: COLORS.ok },
      s.data.numFailedTests > 0
        ? { text: String(s.data.numFailedTests), color: COLORS.fail }
        : '0',
      fmtMs(suiteDuration(s.data)),
    ]),
    [3, 1, 1, 1.2, 1.3],
  ),
);
children.push(spacer());

children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('1.2. Phạm vi kiểm thử')] }),
);
[
  'Tầng Unit: kiểm thử logic nghiệp vụ với repository và các dịch vụ ngoài được giả lập, không phụ thuộc hạ tầng.',
  'Tầng Integration: kiểm thử trên PostgreSQL/TimescaleDB thật — quan hệ cascade, ràng buộc khoá duy nhất, cơ chế nạp trường ảo.',
  'Tầng End-to-End: khởi động toàn bộ ứng dụng, gọi qua giao thức HTTP thật, đi đủ chuỗi xác thực và phân quyền như môi trường vận hành.',
].forEach((t) => children.push(bullet(t)));
children.push(pageBreak());

// 2. Kết quả theo module
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

children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text('2. Kết quả theo module')] }),
);
children.push(
  makeTable(
    ['Module', 'Số tệp', 'Số ca', 'Đạt', 'Không đạt', 'Trạng thái'],
    [...byModule.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([mod, e]) => [
        mod,
        String(e.files.size),
        String(e.total),
        String(e.passed),
        String(e.failed),
        e.failed === 0 ? { text: 'Đạt', color: COLORS.ok } : { text: 'Lỗi', color: COLORS.fail },
      ]),
    [2.5, 1, 1, 1, 1.3, 1.4],
  ),
);
children.push(pageBreak());

// 3. Danh sách ca kiểm thử
children.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [text('3. Danh sách ca kiểm thử chi tiết')],
  }),
);
children.push(
  para(
    'Mỗi ca được gán mã định danh liên tục theo thứ tự tệp. Cột "Nhóm" cho biết khối chức năng ' +
      'mà ca kiểm thử thuộc về.',
  ),
);

let caseIndex = 0;
for (const s of suites) {
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [text(`3.${suites.indexOf(s) + 1}. ${s.label}`)],
    }),
  );

  for (const tr of [...s.data.testResults].sort((a, b) => a.name.localeCompare(b.name))) {
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 100 },
        children: [text(relPath(tr.name), { bold: true, size: 19, color: COLORS.heading })],
      }),
    );

    children.push(
      makeTable(
        ['Mã', 'Nhóm', 'Nội dung kiểm thử', 'Kết quả'],
        tr.assertionResults.map((a) => {
          caseIndex++;
          const group = a.ancestorTitles.slice(1).join(' / ');
          return [
            `TC-${String(caseIndex).padStart(3, '0')}`,
            group || '—',
            a.title,
            a.status === 'passed'
              ? { text: 'Đạt', color: COLORS.ok }
              : a.status === 'failed'
                ? { text: 'Không đạt', color: COLORS.fail }
                : { text: 'Bỏ qua', color: COLORS.warn },
          ];
        }),
        [1.1, 2.6, 5, 1.2],
      ),
    );
  }
}
children.push(pageBreak());

// 4. Ca không đạt
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text('4. Ca kiểm thử không đạt')] }),
);
const failures = [];
for (const s of suites) {
  for (const tr of s.data.testResults) {
    for (const a of tr.assertionResults) {
      if (a.status === 'failed') failures.push({ file: relPath(tr.name), a });
    }
  }
}
if (failures.length === 0) {
  children.push(
    para([text('Không có ca kiểm thử nào thất bại trong lần chạy này.', { color: COLORS.ok })]),
  );
} else {
  for (const f of failures) {
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [text([...f.a.ancestorTitles, f.a.title].join(' / '), { bold: true })],
      }),
    );
    children.push(para(`Tệp: ${f.file}`, { run: { color: COLORS.muted, size: 19 } }));
    (f.a.failureMessages || [])
      .join('\n')
      .split('\n')
      .slice(0, 8)
      .forEach((line) => children.push(para(line, { run: { font: 'Consolas', size: 17 } })));
  }
}
children.push(pageBreak());

// 5. Độ bao phủ
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text('5. Độ bao phủ mã nguồn')] }),
);
if (!coverage) {
  children.push(para('Chưa có dữ liệu độ bao phủ.'));
} else {
  const t = coverage.total;
  children.push(
    para(
      'Độ bao phủ được đo trên tầng Unit. Các tệp chỉ chứa khai báo (entity, DTO, module) ' +
        'đã được loại khỏi phép đo để con số phản ánh đúng phần mã có logic.',
    ),
  );
  children.push(
    makeTable(
      ['Chỉ số', 'Tỷ lệ', 'Đã bao phủ / Tổng'],
      [
        ['Câu lệnh', fmtPct(t.statements.pct), `${t.statements.covered} / ${t.statements.total}`],
        ['Nhánh rẽ', fmtPct(t.branches.pct), `${t.branches.covered} / ${t.branches.total}`],
        ['Hàm', fmtPct(t.functions.pct), `${t.functions.covered} / ${t.functions.total}`],
        ['Dòng lệnh', fmtPct(t.lines.pct), `${t.lines.covered} / ${t.lines.total}`],
      ],
      [2, 1, 2],
    ),
  );
  children.push(spacer());

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [text('5.1. Đối chiếu với mục tiêu đề ra')],
    }),
  );
  const fileEntries = Object.entries(coverage).filter(([k]) => k !== 'total');
  children.push(
    makeTable(
      ['Vùng chức năng', 'Mục tiêu', 'Thực tế', 'Đánh giá'],
      COVERAGE_TARGETS.map((tgt) => {
        const matched = fileEntries.filter(([file]) => relPath(file).startsWith(tgt.pattern));
        if (matched.length === 0)
          return [tgt.label, `${tgt.target}%`, '—', { text: 'Chưa đo', color: COLORS.fail }];
        const covered = matched.reduce((a, [, v]) => a + v.statements.covered, 0);
        const totalSt = matched.reduce((a, [, v]) => a + v.statements.total, 0);
        const pct = totalSt ? (covered / totalSt) * 100 : 0;
        const verdict =
          pct >= tgt.target
            ? { text: 'Đạt', color: COLORS.ok }
            : pct >= tgt.target * 0.6
              ? { text: 'Chưa đạt', color: COLORS.warn }
              : { text: 'Thiếu nhiều', color: COLORS.fail };
        return [tgt.label, `${tgt.target}%`, fmtPct(pct), verdict];
      }),
      [4, 1.2, 1.2, 1.6],
    ),
  );
  children.push(spacer());

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [text('5.2. Chi tiết theo tệp mã nguồn')],
    }),
  );
  children.push(
    para('Sắp xếp tăng dần theo tỷ lệ bao phủ để các vùng còn yếu hiện lên trước.'),
  );
  children.push(
    makeTable(
      ['Tệp mã nguồn', 'Câu lệnh', 'Nhánh', 'Hàm', 'Dòng'],
      fileEntries
        .map(([file, v]) => ({
          file: relPath(file),
          st: v.statements.pct,
          br: v.branches.pct,
          fn: v.functions.pct,
          ln: v.lines.pct,
        }))
        .sort((a, b) => a.st - b.st)
        .map((r) => [
          r.file,
          {
            text: fmtPct(r.st),
            color: r.st >= 80 ? COLORS.ok : r.st >= 50 ? COLORS.warn : COLORS.fail,
          },
          fmtPct(r.br),
          fmtPct(r.fn),
          fmtPct(r.ln),
        ]),
      [4.5, 1.4, 1.4, 1.4, 1.4],
    ),
  );
}
children.push(pageBreak());

// 6. Lỗ hổng
const LEVEL_ORDER = { Cao: 0, 'Trung bình': 1, Thấp: 2 };
const LEVEL_COLOR = { Cao: COLORS.fail, 'Trung bình': COLORS.warn, Thấp: COLORS.muted };
const sortedFindings = [...FINDINGS].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

children.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [text('6. Lỗ hổng và rủi ro phát hiện')],
  }),
);
children.push(
  para(
    'Các vấn đề dưới đây được phát hiện trong quá trình đọc mã nguồn và xây dựng bộ kiểm thử. ' +
      'Nguyên tắc xử lý: viết ca kiểm thử khẳng định hành vi hiện tại thay vì sửa mã nguồn ngay — ' +
      'nhờ đó mọi thay đổi về sau đều là quyết định có chủ đích và được bộ kiểm thử phát hiện lập tức.',
  ),
);
children.push(
  makeTable(
    ['STT', 'Mức độ', 'Vấn đề', 'Vị trí'],
    sortedFindings.map((f, i) => [
      String(i + 1),
      { text: f.level, color: LEVEL_COLOR[f.level] },
      f.title,
      f.where,
    ]),
    [0.7, 1.4, 5, 3],
  ),
);
children.push(spacer());

sortedFindings.forEach((f, i) => {
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [text(`6.${i + 1}. ${f.title}`)],
    }),
  );
  children.push(
    makeTable(
      ['Thuộc tính', 'Nội dung'],
      [
        ['Mức độ', { text: f.level, color: LEVEL_COLOR[f.level] }],
        ['Vị trí', f.where],
        ['Mô tả', f.detail],
        ['Bằng chứng kiểm thử', f.evidence],
        ['Khuyến nghị khắc phục', f.fix],
      ],
      [1.6, 5],
    ),
  );
  children.push(spacer());
});
children.push(pageBreak());

// 7. Khuyến nghị
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text('7. Khuyến nghị')] }),
);
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('7.1. Ưu tiên cao')] }),
);
const highFindings = sortedFindings.filter((f) => f.level === 'Cao');
highFindings.forEach((f) => children.push(bullet(`${f.title} — ${f.fix}`)));
children.push(
  bullet('Bổ sung kiểm tra phạm vi đập cho CameraController và EvidenceController.'),
);

children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('7.2. Ưu tiên trung bình')] }),
);
if (coverage) {
  const weak = Object.entries(coverage)
    .filter(([k]) => k !== 'total')
    .filter(([, v]) => v.statements.pct < 50)
    .map(([f]) => relPath(f));
  if (weak.length) {
    children.push(bullet(`Nâng độ bao phủ cho ${weak.length} tệp còn dưới 50%.`));
  }
}
[
  'Thiết lập quy trình tích hợp liên tục để chạy tầng Unit trên mọi thay đổi mã nguồn.',
  'Đặt ngưỡng độ bao phủ tối thiểu trong cấu hình để ngăn chất lượng tụt lùi.',
  'Bổ sung kiểm thử cho luồng MQTT và WebSocket với hạ tầng thật.',
].forEach((t) => children.push(bullet(t)));
children.push(pageBreak());

// 8. Phụ lục
children.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [text('8. Phụ lục — Hướng dẫn tái lập kết quả')],
  }),
);
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('8.1. Các lệnh thực thi')] }),
);
[
  ['npm ci', 'Cài đặt phụ thuộc đúng phiên bản đã khoá'],
  ['npm run test:unit -- --coverage', 'Chạy tầng Unit kèm đo độ bao phủ'],
  ['npm run test:infra:up', 'Khởi động PostgreSQL và MQTT phục vụ kiểm thử'],
  ['npm run test:int', 'Chạy tầng Integration'],
  ['npm run test:e2e', 'Chạy tầng End-to-End'],
  ['npm run test:rt', 'Chạy tầng Realtime (MQTT và WebSocket)'],
  ['npm run test:report', 'Sinh lại toàn bộ báo cáo'],
].forEach(([cmd, desc]) => {
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [text(cmd, { font: 'Consolas', size: 19 }), text(`  —  ${desc}`, { size: 19 })],
    }),
  );
});
children.push(spacer());

children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('8.2. Cấu hình môi trường')] }),
);
children.push(
  makeTable(
    ['Thành phần', 'Cổng môi trường phát triển', 'Cổng môi trường kiểm thử'],
    [
      ['PostgreSQL / TimescaleDB', '5432', '5433'],
      ['MQTT (Mosquitto)', '1883', '1884'],
      ['MinIO', '9000', 'Giả lập ở cấp mô-đun'],
    ],
    [2, 2, 2],
  ),
);
children.push(spacer());

children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text('8.3. Quy ước đặt tên tệp')] }),
);
[
  '*.spec.ts — kiểm thử đơn vị, đặt cạnh tệp mã nguồn tương ứng.',
  '*.int-spec.ts — kiểm thử tích hợp, đặt trong thư mục test/integration.',
  '*.e2e-spec.ts — kiểm thử đầu-cuối, đặt trong thư mục test.',
].forEach((t) => children.push(bullet(t)));

// ── Xuất tệp ──

const doc = new Document({
  creator: 'Bộ sinh báo cáo kiểm thử tự động',
  title: 'Báo cáo Kiểm thử — Hệ thống Giám sát Đập Thủy điện',
  description: `Tổng hợp ${total.tests} ca kiểm thử`,
  styles: {
    default: {
      document: { run: { font: 'Times New Roman', size: 24 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 32, bold: true, color: COLORS.heading, font: 'Times New Roman' },
        paragraph: { spacing: { before: 280, after: 160 } },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 27, bold: true, color: COLORS.heading, font: 'Times New Roman' },
        paragraph: { spacing: { before: 220, after: 120 } },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullet-list',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' } },
              children: [
                text('Báo cáo Kiểm thử — Hệ thống Giám sát Đập Thủy điện', {
                  size: 18,
                  color: COLORS.muted,
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                text('Trang ', { size: 18, color: COLORS.muted }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, color: COLORS.muted }),
                text(' / ', { size: 18, color: COLORS.muted }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: COLORS.muted }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`Đã sinh báo cáo Word: ${path.relative(process.cwd(), OUTPUT)}`);
});
