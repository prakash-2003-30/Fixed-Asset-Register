// Indian digit grouping (lakh/crore) for a run of integer digits.
// e.g. "222222" -> "2,22,222", "12345678" -> "1,23,45,678".
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const head = digits.slice(0, -3);
  return head.replace(/\B(?=(\d\d)+(?!\d))/g, ',') + ',' + last3;
}

// Display-only Indian formatting for the verbatim-stored Cost field. Numeric
// values (with or without existing commas, optional sign/decimals) are regrouped;
// non-numeric text (e.g. "Complimendary") is returned unchanged. Used by the PDF
// and Excel exports so reports match the grid. The stored value is never altered.
export function formatIndianCost(v: unknown): string {
  if (v == null) return '';
  const raw = String(v).trim();
  if (!raw) return '';
  const m = raw.replace(/,/g, '').match(/^(-?)(\d+)(\.\d+)?$/);
  if (!m) return raw;
  const sign = m[1];
  const intPart = m[2];
  const dec = m[3] ?? '';
  return `₹ ${sign}${groupIndian(intPart)}${dec}`; // ₹ prefix to match the UI/exports
}
