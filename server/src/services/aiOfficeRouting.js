const TZ = 'Asia/Ho_Chi_Minh';

// Preserve old stored jobs without presenting the removed characters as AI.
function agentLabel(agent) {
  return ({ An: 'Điều phối', Linh: 'Nghiên cứu', Minh: 'Phân tích', Mai: 'Nội dung',
    'Bông': 'Thiết kế', Nam: 'Video', 'Hà': 'Sản phẩm', 'Tú': 'Kỹ thuật' })[agent] || agent || 'AI';
}

function plain(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
}

function classify(question, requestedProvider = 'auto') {
  const q = plain(question);
  const technical = /\b(code|bug|loi code|sua loi|debug|lap trinh|script|api|file|tep|csv|excel|ffmpeg|dung video|ghep video|cat video|render|tu dong hoa|html|svg)\b/.test(q);
  const codeWork = /\b(code|bug|loi code|sua loi|debug|lap trinh|api)\b/.test(q);
  const video = /\b(video|clip|kich ban|storyboard|canh quay)\b/.test(q);
  const design = /\b(thiet ke|hinh anh|bo cuc|banner|poster|logo|moodboard|svg)\b/.test(q);
  const research = /\b(nghien cuu|tim nguon|tim kiem|doi thu|thi truong|github|repository|repo|ma nguon mo)\b/.test(q);
  const sales = /\b(doanh thu|ban hang|don hang|bao nhieu don|loi nhuan|hoan tien|ngay \d{1,2}[\/-]\d{1,2})\b/.test(q);
  const product = /\b(san pham|sku|gia ban|ton kho|quang cao|roas|chien dich)\b/.test(q);
  const kind = codeWork ? 'technical' : research ? 'research' : video ? 'video' : design ? 'design'
    : technical ? 'technical' : sales ? 'sales' : product ? 'product' : 'general';
  const agent = kind === 'sales' ? 'Phân tích' : kind === 'product' ? 'Sản phẩm'
    : kind === 'video' ? 'Video' : kind === 'technical' ? 'Kỹ thuật' : kind === 'research' ? 'Nghiên cứu' : kind === 'design' ? 'Thiết kế' : 'Nội dung';
  const provider = requestedProvider === 'claude' || requestedProvider === 'codex'
    ? requestedProvider : technical ? 'codex' : 'claude';
  const reason = requestedProvider !== 'auto' && requestedProvider === provider
    ? 'Bạn đã chọn AI này'
    : provider === 'codex' ? 'Câu hỏi cần xử lý tệp hoặc thao tác kỹ thuật'
      : sales ? 'Câu hỏi cần đọc số liệu kinh doanh'
        : video ? 'Câu hỏi cần ý tưởng hoặc kịch bản video'
          : 'Câu hỏi cần phân tích hoặc viết nội dung';
  return { kind, agent, provider, reason };
}

function localToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { day: Number(p.day), month: Number(p.month), year: Number(p.year) };
}

function salesDate(question, now = new Date()) {
  const q = plain(question);
  const today = localToday(now);
  const requestedDays = q.match(/\b(\d{1,3})\s*ngay\b/);
  const days = requestedDays ? Number(requestedDays[1]) : 1;
  if (days < 1 || days > 90) throw new Error('Kỳ báo cáo cần từ 1 đến 90 ngày');
  const found = q.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\b/);
  let { day, month, year } = today;
  if (found) {
    day = Number(found[1]); month = Number(found[2]); year = Number(found[3] || year);
  } else if (/hom qua|yesterday/.test(q)) {
    const d = new Date(Date.UTC(year, month - 1, day) - 86400000);
    day = d.getUTCDate(); month = d.getUTCMonth() + 1; year = d.getUTCFullYear();
  }
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCDate() !== day || valid.getUTCMonth() + 1 !== month || valid.getUTCFullYear() !== year)
    throw new Error('Ngày báo cáo không hợp lệ');
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const endDayStart = Math.floor(Date.parse(`${date}T00:00:00+07:00`) / 1000);
  const from = endDayStart - (days - 1) * 86400;
  const startDate = new Date((from + 7 * 3600) * 1000).toISOString().slice(0, 10);
  return { date, start_date: startDate, end_date: date, days, from, to: endDayStart + 86400, timezone: TZ };
}

module.exports = { classify, salesDate, plain, agentLabel };
