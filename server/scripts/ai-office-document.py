"""Extract uploaded XLSX/TXT as data, without executing formulas or macros."""
import codecs
import csv
import io
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET

LIMIT = 20 * 1024 * 1024
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def extract(source, extension):
    if extension == '.txt':
        raw = open(source, 'rb').read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('Tệp quá lớn')
        encoding = 'utf-16' if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)) else 'utf-8-sig'
        text = raw.decode(encoding)
        if '\x00' in text:
            raise ValueError('TXT phải là văn bản UTF-8 hoặc UTF-16')
        return text
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
            raise ValueError('Excel giải nén vượt giới hạn 100 MB hoặc quá nhiều mục')
        def xml(name):
            data = archive.read(name)
            if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                raise ValueError('XML không hợp lệ')
            return ET.fromstring(data)
        workbook = xml('xl/workbook.xml')
        rels = {r.get('Id'): r.get('Target') for r in xml('xl/_rels/workbook.xml.rels')
                if r.get('TargetMode') != 'External'}
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [
                ''.join(t.text or '' for t in si.findall('.//s:t', NS))
                for si in xml('xl/sharedStrings.xml').findall('s:si', NS)]
        output = io.StringIO()
        writer = csv.writer(output, delimiter='\t', lineterminator='\n')
        output.write('Dữ liệu Excel; công thức giữ biểu thức và kết quả lưu sẵn (nếu có), không tính lại. Ngày có thể là số serial theo định dạng ô.\n')
        for sheet in workbook.findall('s:sheets/s:sheet', NS):
            rel = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = rels.get(rel)
            if not target:
                continue
            name = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
            if not name.startswith('xl/'):
                raise ValueError('Đường dẫn sheet không hợp lệ')
            output.write('\nSheet: ' + json.dumps(sheet.get('name', ''), ensure_ascii=False) + '\n')
            writer.writerow(['Dòng', 'Ô', 'Kiểu', 'Giá trị', 'Công thức'])
            for row in xml(name).findall('s:sheetData/s:row', NS):
                for cell in row.findall('s:c', NS):
                    kind = cell.get('t', 'n')
                    value = cell.findtext('s:v', '', NS)
                    if kind == 's':
                        value = strings[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                    writer.writerow([row.get('r', ''), cell.get('r', ''), kind, value, cell.findtext('s:f', '', NS)])
                    if output.tell() > LIMIT:
                        raise ValueError('Nội dung Excel vượt giới hạn 20 MB; hãy tách file')
        return output.getvalue()


if __name__ == '__main__':
    try:
        text = extract(sys.argv[1], sys.argv[3])
        encoded = text.encode('utf-8')
        if len(encoded) > LIMIT:
            raise ValueError('Nội dung văn bản vượt giới hạn 20 MB; hãy tách file')
        with open(sys.argv[2], 'wb') as output:
            output.write(encoded)
    except Exception as error:
        print('Không đọc được tệp: ' + str(error), file=sys.stderr)
        sys.exit(1)
