const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, salesDate } = require('../src/services/aiOfficeRouting');

test('selects Claude for business questions and Codex for technical questions', () => {
  assert.deepEqual([classify('Doanh thu shop ngày 20/10').kind, classify('Doanh thu shop ngày 20/10').provider], ['sales', 'claude']);
  assert.deepEqual([classify('Lỗi code xử lý file CSV').kind, classify('Lỗi code xử lý file CSV').provider], ['technical', 'codex']);
  assert.equal(classify('Dựng video quảng cáo sản phẩm').provider, 'codex');
  assert.equal(classify('Viết kịch bản video').provider, 'claude');
  assert.equal(classify('Đơn hàng hôm qua').kind, 'sales');
  assert.equal(classify('Lỗi code', 'claude').provider, 'claude');
  assert.deepEqual(['Doanh thu 20/10', 'Giá bán sản phẩm', 'Viết kịch bản video', 'Lỗi code', 'Viết bài giới thiệu']
    .map(question => classify(question).agent), ['Phân tích', 'Sản phẩm', 'Video', 'Kỹ thuật', 'Nội dung']);
});

test('uses Vietnam day boundaries and validates requested dates', () => {
  const now = new Date('2026-10-21T00:30:00+07:00');
  assert.equal(salesDate('Doanh thu 20/10', now).date, '2026-10-20');
  assert.equal(salesDate('Doanh thu hôm qua', now).date, '2026-10-20');
  assert.equal(salesDate('Doanh thu hôm nay', now).date, '2026-10-21');
  assert.equal(salesDate('Doanh thu 20/10', now).to - salesDate('Doanh thu 20/10', now).from, 86400);
  const month = salesDate('doanh thu 30 ngày gần nhất của shop', now);
  assert.deepEqual([month.start_date, month.end_date, month.days], ['2026-09-22', '2026-10-21', 30]);
  assert.equal(month.to - month.from, 30 * 86400);
  assert.equal(salesDate('7 ngày gần nhất tính đến 20/10', now).start_date, '2026-10-14');
  assert.throws(() => salesDate('Doanh thu 365 ngày', now), /1 đến 90 ngày/);
  assert.throws(() => salesDate('Doanh thu 31/2', now), /không hợp lệ/);
});
