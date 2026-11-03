// lib/fileTypes.ts의 validateSheetUpload 자체 검사.
// 사용법: node scripts/checkUploadValidation.mjs (Node 24 이상, 실패하면 예외로 종료)

import assert from 'node:assert/strict';
import { MAX_SHEET_FILE_BYTES, validateSheetUpload } from '../lib/fileTypes.ts';

const team = '12b2448c-73ea-439b-8db8-61af16f004f3';
const id = '5e16feef-6885-41cb-8adc-5d3d9c001047';
const path = (name) => `r2/${team}/${name}`;

// 앱이 실제로 만드는 조합은 통과해야 한다.
for (const [name, type] of [
  [`${id}.pdf`, 'application/pdf'],
  [`${id}.jpg`, 'image/jpeg'],
  [`${id}.jpeg`, 'image/jpeg'],
  [`${id}.png`, 'image/png'],
  [`${id}.webp`, 'image/webp'],
  [`${id}_thumb.jpg`, 'image/jpeg'],
]) {
  assert.equal(validateSheetUpload(path(name), type, 1), null, name);
}
assert.equal(validateSheetUpload(path(`${id}.pdf`), 'application/pdf', MAX_SHEET_FILE_BYTES), null);

// 경로
for (const bad of [
  `${team}/${id}.pdf`,
  `r2/${team}/../other/${id}.pdf`,
  `r2/${team}/x/${id}.pdf`,
  `r2/not-a-team/${id}.pdf`,
  path('evil.pdf'),
  [path(`${id}.pdf`)],
  undefined,
]) {
  assert.equal(validateSheetUpload(bad, 'application/pdf', 1), '잘못된 경로입니다.', String(bad));
}

// 형식: 허용되지 않은 형식과 확장자-형식 불일치
for (const [name, type] of [
  [`${id}.html`, 'text/html'],
  [`${id}.svg`, 'image/svg+xml'],
  [`${id}.pdf`, 'text/html'],
  [`${id}.png`, 'application/pdf'],
  [`${id}.pdf`, undefined],
  [`${id}.constructor`, undefined],
]) {
  assert.match(validateSheetUpload(path(name), type, 1), /업로드할 수 있습니다/, `${name} ${type}`);
}

// 크기
for (const size of [undefined, 0, -1, 1.5, '1']) {
  assert.equal(validateSheetUpload(path(`${id}.pdf`), 'application/pdf', size), '파일 크기를 확인할 수 없습니다.');
}
assert.match(validateSheetUpload(path(`${id}.pdf`), 'application/pdf', MAX_SHEET_FILE_BYTES + 1), /너무 큽니다/);

console.log('ok');
