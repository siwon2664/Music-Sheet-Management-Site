'use client';

import { useState, type Key, type ReactNode } from 'react';

interface TermsAgreementModalProps {
  termsText: string;
  privacyText: string;
  loading: boolean;
  onAgree: () => void;
  onCancel: () => void;
}

// docs/*.md는 운영자가 직접 보는 초안이라 "> 초안 안내" 같은 안내 블록과
// HTML 주석이 섞여 있다. 이용자에게는 그 부분을 빼고 보여준다.
function renderLegalText(text: string): ReactNode[] {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutComments.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  function flushList(key: Key) {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-0.5">
          {listItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('>')) return; // 운영자용 초안 안내 — 이용자에게 노출하지 않음
    if (trimmed === '') {
      flushList(`ul-${idx}`);
      return;
    }
    if (trimmed.startsWith('### ')) {
      flushList(`ul-${idx}`);
      blocks.push(
        <h4 key={idx} className="font-semibold mt-3">
          {trimmed.slice(4)}
        </h4>
      );
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList(`ul-${idx}`);
      blocks.push(
        <h3 key={idx} className="font-bold mt-4">
          {trimmed.slice(3)}
        </h3>
      );
      return;
    }
    if (trimmed.startsWith('# ')) {
      flushList(`ul-${idx}`);
      blocks.push(
        <h2 key={idx} className="text-lg font-bold">
          {trimmed.slice(2)}
        </h2>
      );
      return;
    }
    if (trimmed.startsWith('- ')) {
      listItems.push(trimmed.slice(2));
      return;
    }
    flushList(`ul-${idx}`);
    blocks.push(
      <p key={idx} className="leading-relaxed">
        {trimmed}
      </p>
    );
  });
  flushList('ul-end');

  return blocks;
}

export default function TermsAgreementModal({
  termsText,
  privacyText,
  loading,
  onAgree,
  onCancel,
}: TermsAgreementModalProps) {
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  const canAgree = agreeTerms && agreePrivacy;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">약관 동의</h2>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => setTab('terms')}
              className={`text-sm px-3 py-1.5 rounded ${
                tab === 'terms' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              이용약관
            </button>
            <button
              type="button"
              onClick={() => setTab('privacy')}
              className={`text-sm px-3 py-1.5 rounded ${
                tab === 'privacy' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              개인정보처리방침
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm space-y-2">
          {renderLegalText(tab === 'terms' ? termsText : privacyText)}
        </div>

        <div className="p-4 border-t flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
            />
            [필수] 이용약관에 동의합니다.
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreePrivacy}
              onChange={(e) => setAgreePrivacy(e.target.checked)}
            />
            [필수] 개인정보처리방침에 동의합니다.
          </label>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 border rounded px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onAgree}
              disabled={!canAgree || loading}
              className="flex-1 bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {loading ? '처리 중...' : '동의하고 계속하기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
