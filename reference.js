/* English reference → USFM passage ID ("Psalm 23:1-3" → "PSA.23.1-3"). Browser + Node.
   Book names only; no Scripture. USFM IDs ("PSA.23.1") pass through unchanged. */
(function (root) {
  'use strict';
  // USFM code, then names/abbreviations (lowercase, without spaces or periods).
  const BOOKS = [
    ['GEN', 'genesis', 'gen', 'ge', 'gn'], ['EXO', 'exodus', 'exod', 'exo', 'ex'],
    ['LEV', 'leviticus', 'lev', 'le', 'lv'], ['NUM', 'numbers', 'num', 'nu', 'nm'],
    ['DEU', 'deuteronomy', 'deut', 'deu', 'dt'], ['JOS', 'joshua', 'josh', 'jos'],
    ['JDG', 'judges', 'judg', 'jdg', 'jg'], ['RUT', 'ruth', 'rut', 'ru'],
    ['1SA', '1samuel', '1sam', '1sa'], ['2SA', '2samuel', '2sam', '2sa'],
    ['1KI', '1kings', '1kgs', '1ki'], ['2KI', '2kings', '2kgs', '2ki'],
    ['1CH', '1chronicles', '1chron', '1chr', '1ch'], ['2CH', '2chronicles', '2chron', '2chr', '2ch'],
    ['EZR', 'ezra', 'ezr'], ['NEH', 'nehemiah', 'neh', 'ne'], ['EST', 'esther', 'esth', 'est'],
    ['JOB', 'job', 'jb'], ['PSA', 'psalms', 'psalm', 'psa', 'ps', 'pss'],
    ['PRO', 'proverbs', 'prov', 'pro', 'prv', 'pr'], ['ECC', 'ecclesiastes', 'eccl', 'eccles', 'ecc', 'ec'],
    ['SNG', 'songofsongs', 'songofsolomon', 'song', 'sos', 'sng'], ['ISA', 'isaiah', 'isa', 'is'],
    ['JER', 'jeremiah', 'jer', 'je'], ['LAM', 'lamentations', 'lam', 'la'],
    ['EZK', 'ezekiel', 'ezek', 'ezk', 'eze'], ['DAN', 'daniel', 'dan', 'da', 'dn'],
    ['HOS', 'hosea', 'hos', 'ho'], ['JOL', 'joel', 'jol', 'jl'], ['AMO', 'amos', 'amo', 'am'],
    ['OBA', 'obadiah', 'obad', 'oba', 'ob'], ['JON', 'jonah', 'jon', 'jnh'],
    ['MIC', 'micah', 'mic', 'mi'], ['NAM', 'nahum', 'nah', 'nam', 'na'],
    ['HAB', 'habakkuk', 'hab'], ['ZEP', 'zephaniah', 'zeph', 'zep'], ['HAG', 'haggai', 'hag', 'hg'],
    ['ZEC', 'zechariah', 'zech', 'zec'], ['MAL', 'malachi', 'mal'],
    ['MAT', 'matthew', 'matt', 'mat', 'mt'], ['MRK', 'mark', 'mrk', 'mk', 'mar'],
    ['LUK', 'luke', 'luk', 'lk'], ['JHN', 'john', 'jhn', 'jn', 'joh'],
    ['ACT', 'acts', 'act', 'ac'], ['ROM', 'romans', 'rom', 'ro', 'rm'],
    ['1CO', '1corinthians', '1cor', '1co'], ['2CO', '2corinthians', '2cor', '2co'],
    ['GAL', 'galatians', 'gal', 'ga'], ['EPH', 'ephesians', 'eph'],
    ['PHP', 'philippians', 'phil', 'php', 'pp'], ['COL', 'colossians', 'col'],
    ['1TH', '1thessalonians', '1thess', '1th'], ['2TH', '2thessalonians', '2thess', '2th'],
    ['1TI', '1timothy', '1tim', '1ti'], ['2TI', '2timothy', '2tim', '2ti'],
    ['TIT', 'titus', 'tit'], ['PHM', 'philemon', 'philem', 'phm'], ['HEB', 'hebrews', 'heb'],
    ['JAS', 'james', 'jas', 'jm'], ['1PE', '1peter', '1pet', '1pe', '1pt'], ['2PE', '2peter', '2pet', '2pe', '2pt'],
    ['1JN', '1john', '1jn', '1jo', '1jhn'], ['2JN', '2john', '2jn', '2jo', '2jhn'], ['3JN', '3john', '3jn', '3jo', '3jhn'],
    ['JUD', 'jude', 'jud', 'jd'], ['REV', 'revelation', 'rev', 're', 'rv'],
  ];
  const NAMES = new Map();
  for (const [code, ...names] of BOOKS) for (const name of [code.toLowerCase(), ...names]) NAMES.set(name, code);
  const ROMAN = { i: '1', ii: '2', iii: '3' };
  const USFM = /^([1-3A-Z][A-Z0-9]{2})\.([1-9]\d*)(?:\.([1-9]\d*)(?:-([1-9]\d*))?)?$/;

  // Returns a USFM passage ID, or null if the text is not a recognisable reference.
  function toPassageId(input) {
    const text = String(input ?? '').trim();
    if (USFM.test(text)) return valid(text);
    const match = /^((?:[1-3]|i{1,3})\s*)?([a-z][a-z .]*?)\.?\s+(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/i.exec(text);
    if (!match) return null;
    const number = match[1] ? (ROMAN[match[1].trim().toLowerCase()] || match[1].trim()) : '';
    const code = NAMES.get(number + match[2].toLowerCase().replace(/[ .]/g, ''));
    if (!code) return null;
    const [, , , chapter, verse, end] = match;
    return valid(`${code}.${Number(chapter)}${verse ? `.${Number(verse)}${end ? `-${Number(end)}` : ''}` : ''}`);
  }
  function valid(id) {
    const match = USFM.exec(id);
    if (!match || id.length > 64 || (match[4] && Number(match[4]) < Number(match[3]))) return null;
    return id;
  }
  root.SurfaceReference = { toPassageId };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SurfaceReference;
})(globalThis);
