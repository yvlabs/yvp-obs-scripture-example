const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toPassageId } = require('./reference.js');

test('common English references become USFM passage IDs', () => {
  for (const [input, expected] of [
    ['Psalm 23:1', 'PSA.23.1'], ['psalms 23', 'PSA.23'], ['Ps 23:1-3', 'PSA.23.1-3'],
    ['John 3:16', 'JHN.3.16'], ['Jn 3.16', 'JHN.3.16'], ['1 John 4:8', '1JN.4.8'],
    ['1John 4:8', '1JN.4.8'], ['I Corinthians 13:4–7', '1CO.13.4-7'], ['II Kings 2', '2KI.2'],
    ['Song of Songs 2:4', 'SNG.2.4'], ['Rom. 8:38-39', 'ROM.8.38-39'], ['  Gen 1 : 1 ', 'GEN.1.1'],
    ['Phil 4:13', 'PHP.4.13'], ['Philemon 1:6', 'PHM.1.6'], ['Revelation 21:4', 'REV.21.4'],
  ]) assert.equal(toPassageId(input), expected, input);
});

test('USFM IDs pass through; invalid input is refused rather than guessed', () => {
  assert.equal(toPassageId('PSA.23.1'), 'PSA.23.1');
  assert.equal(toPassageId('1CO.13.4-7'), '1CO.13.4-7');
  for (const input of ['', 'hello', 'Psalm', 'Psalm 0:1', 'Psalm 23:5-2', 'Hezekiah 3:1',
    'PSA.23.1; drop', '<script>', 'John 3:16, 18', null, undefined]) {
    assert.equal(toPassageId(input), null, String(input));
  }
});
