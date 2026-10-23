// A small DOM-only renderer: AI text is never passed to innerHTML.
function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function inline(parent, text, imageResolver) {
  const tokens = /!\[([^\]]*)\]\((<[^>\n]+>|[^)\n]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/gi;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(offset, match.index)));
    if (match[2]) {
      const source = match[2].startsWith('<') ? match[2].slice(1,-1) : match[2];
      const url = /^https?:\/\//i.test(source) ? source : imageResolver?.(source);
      if (url) {
        const figure = element('figure'); figure.className = 'live-answer-image';
        const link = element('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const image = element('img'); image.src = url; image.alt = match[1];
        image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
        link.append(image); figure.append(link, element('figcaption', match[1])); parent.append(figure);
      } else parent.append(document.createTextNode(match[0]));
    } else if (match[4]) {
      const link = element('a', match[3]); link.href = match[4]; link.target = '_blank';
      link.rel = 'noopener noreferrer'; parent.append(link);
    } else parent.append(element(match[5] ? 'strong' : 'code', match[5] || match[6]));
    offset = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}

const separator = line => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(value => value.trim().replace(/\\\|/g, '|'));
const bullet = line => /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);

export function renderAnswer(parent, content, imageResolver) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const pre = element('pre'); pre.append(element('code', code.join('\n'))); parent.append(pre); i++; continue;
    }
    if (i + 1 < lines.length && line.includes('|') && separator(lines[i + 1])) {
      const wrap = element('div'); wrap.className = 'live-table-scroll'; wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Bảng thống kê, cuộn ngang để xem thêm');
      const table = element('table'), head = element('thead'), header = element('tr');
      for (const value of cells(line)) { const cell = element('th'); inline(cell, value, imageResolver); header.append(cell); }
      head.append(header); table.append(head);
      const body = element('tbody'); i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const row = element('tr');
        for (const value of cells(lines[i])) { const cell = element('td'); inline(cell, value, imageResolver); row.append(cell); }
        body.append(row); i++;
      }
      table.append(body); wrap.append(table); parent.append(wrap); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const node = element(`h${Math.min(6, heading[1].length + 2)}`); inline(node, heading[2], imageResolver); parent.append(node); i++; continue;
    }
    if (bullet(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line), list = element(ordered ? 'ol' : 'ul');
      while (i < lines.length && bullet(lines[i]) && /^\s*\d+[.)]\s+/.test(lines[i]) === ordered) {
        const item = element('li'); inline(item, lines[i].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''), imageResolver); list.append(item); i++;
      }
      parent.append(list); continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { parent.append(element('hr')); i++; continue; }
    const paragraph = element('p'); inline(paragraph, line, imageResolver); parent.append(paragraph); i++;
  }
}
