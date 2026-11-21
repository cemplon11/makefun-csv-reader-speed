// Fast csv-reader-compatible CSV reader.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Semantics (from the competition rules):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote; CRLF or a lone CR inside is read as LF; what
//   follows the closing quote up to the next comma or line break is appended
//   as it stands (error quote_junk when the field ends, if anything was kept);
//   a quote that never closes is a literal character and the text after it is
//   read again as unquoted (error unterminated_quote).
// - A quote inside an unquoted field is literal. Fields stay strings.
// - columns is the first record when header is true, else null; rows holds the
//   records after it (every record when header is false), each padded with ""
//   (short_row, with fields: its count) or cut (long_row, with extra: the cut
//   fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line the record starts on (every LF, CRLF and lone CR inside quotes
//   counted), row the record's index in rows (null for the header).
//
// Speed: a record holding no quote and no stray CR is taken whole with one
// slice + split(','). Other records are read field by field, jumping between
// delimiters with one regex scan per field instead of walking character by
// character, and the field readers report through shared locals instead of
// allocating a result per field. Pure: no clock, no randomness, nothing kept
// from one call to the next.

const COMMA = 0;
const BREAK = 1;
const END = 2;

// Shared scanners; lastIndex is set before every use, so no state leaks
// between calls or into the answer.
const delimRe = /[,\r\n]/g; // next comma, CR or LF
const lineRe = /["\r\n]/g; // next quote, CR or LF

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next character to read
  let line = 1; // line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters
  // were kept onto it (the quote_junk check counts kept characters only).
  let fVal = '';
  let fEnd = END;
  let fAdded = 0;

  // Breaks counted inside the quoted segment currently being read; only
  // committed to `line` once the quote is known to close.
  let segBreaks = 0;

  function finishRecord(fields, quotedLast) {
    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quotedLast) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // The value of text[a..b) as the inside of a quoted field: CRLF and lone CR
  // each become one LF, and segBreaks counts the line breaks in it.
  function quotedSegment(a, b) {
    const r = text.indexOf('\r', a);
    const hasCR = r !== -1 && r < b;
    const nl = text.indexOf('\n', a);
    const hasNL = nl !== -1 && nl < b;
    if (!hasCR && !hasNL) return text.slice(a, b);
    const s = text.slice(a, b);
    let breaks = 0;
    for (let i = 0; i < s.length; i++) {
      const cc = s.charCodeAt(i);
      if (cc === 13) {
        breaks++;
        if (s.charCodeAt(i + 1) === 10) i++;
      } else if (cc === 10) {
        breaks++;
      }
    }
    segBreaks += breaks;
    return s.replace(/\r\n?/g, '\n');
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fVal, fEnd, fAdded.
  function readUnquoted(value) {
    let added = 0;
    delimRe.lastIndex = pos;
    for (;;) {
      const m = delimRe.exec(text);
      if (m === null) {
        fVal = value + text.slice(pos, n);
        fAdded = added + (n - pos);
        fEnd = END;
        pos = n;
        return;
      }
      const end = m.index;
      const cc = m[0].charCodeAt(0);
      if (cc === 44) {
        fVal = value + text.slice(pos, end);
        fAdded = added + (end - pos);
        fEnd = COMMA;
        pos = end + 1;
        return;
      }
      if (cc === 10) {
        fVal = value + text.slice(pos, end);
        fAdded = added + (end - pos);
        fEnd = BREAK;
        pos = end + 1;
        line += 1;
        return;
      }
      // CR
      if (text.charCodeAt(end + 1) === 10) {
        fVal = value + text.slice(pos, end);
        fAdded = added + (end - pos);
        fEnd = BREAK;
        pos = end + 2;
        line += 1;
        return;
      }
      // Stray CR: dropped, the field goes on.
      value += text.slice(pos, end);
      added += end - pos;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = end + 1;
      delimRe.lastIndex = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal, fEnd, fAdded.
  function readQuoted() {
    const open = pos;
    let value = '';
    pos += 1;
    segBreaks = 0;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted. `line` was never advanced past
        // the opening line, so nothing needs rewinding.
        pos = open + 1;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one quote in the value, the field goes on.
        value += quotedSegment(pos, q);
        value += '"';
        pos = q + 2;
        continue;
      }
      // Closing quote.
      value += quotedSegment(pos, q);
      line += segBreaks;
      pos = q + 1;
      if (pos >= n) {
        fVal = value;
        fAdded = 0;
        fEnd = END;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        fVal = value;
        fAdded = 0;
        fEnd = COMMA;
        pos += 1;
        return;
      }
      if (c === 10) {
        fVal = value;
        fAdded = 0;
        fEnd = BREAK;
        pos += 1;
        line += 1;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        fVal = value;
        fAdded = 0;
        fEnd = BREAK;
        pos += 2;
        line += 1;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      readUnquoted(value);
      if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
  }

  // Reads one record that holds a quote or a stray CR, field by field.
  // The unquoted scan is inline here: it is the hot path of this record.
  function slowRecord() {
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        let value = '';
        let added = 0;
        delimRe.lastIndex = pos;
        for (;;) {
          const m = delimRe.exec(text);
          if (m === null) {
            fVal = value + text.slice(pos, n);
            fAdded = added + (n - pos);
            fEnd = END;
            pos = n;
            break;
          }
          const end = m.index;
          const cc = m[0].charCodeAt(0);
          if (cc === 44) {
            fVal = value + text.slice(pos, end);
            fAdded = added + (end - pos);
            fEnd = COMMA;
            pos = end + 1;
            break;
          }
          if (cc === 10) {
            fVal = value + text.slice(pos, end);
            fAdded = added + (end - pos);
            fEnd = BREAK;
            pos = end + 1;
            line += 1;
            break;
          }
          if (text.charCodeAt(end + 1) === 10) {
            fVal = value + text.slice(pos, end);
            fAdded = added + (end - pos);
            fEnd = BREAK;
            pos = end + 2;
            line += 1;
            break;
          }
          value += text.slice(pos, end);
          added += end - pos;
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos = end + 1;
          delimRe.lastIndex = pos;
        }
      }
      fields.push(fVal);
      if (fEnd !== COMMA) break;
    }
    finishRecord(fields, quoted);
  }

  while (pos < n) {
    // The first quote, CR or LF decides the whole record: a quote, or a CR
    // not followed by LF, means the slow path; a LF, or a CR followed by LF,
    // ends a clean record, taken whole with one slice + split(',').
    lineRe.lastIndex = pos;
    const m = lineRe.exec(text);
    if (m === null) {
      // The last record, with no line break after it: no quote, no CR in it.
      recordLine = line;
      recordRow = header && columns === null ? null : rows.length;
      const fields = text.slice(pos, n).split(',');
      pos = n;
      finishRecord(fields, false);
      continue;
    }
    const end = m.index;
    const cc = m[0].charCodeAt(0);
    if (cc === 34 || (cc === 13 && text.charCodeAt(end + 1) !== 10)) {
      slowRecord();
      continue;
    }
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = text.slice(pos, end).split(',');
    line += 1;
    pos = cc === 10 ? end + 1 : end + 2;
    finishRecord(fields, false);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
