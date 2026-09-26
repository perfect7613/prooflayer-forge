import type { Evidence } from './types';
export interface GeneratedView { id: string; content: string; createdAt: string; eventId: string; sessionId?: string; }
export const VISUAL_INSTRUCTIONS = `After write_report, load TrueForge's get_openui_instructions and emit one fenced openui program to illustrate the recorded measurements. This workspace provides a READ-ONLY CUSTOM CATALOG that replaces the default catalog:
Stack(children) ; Card(children); CardHeader(title, subtitle); TextContent(text);
EvidenceChart(evidenceId, arrayPath, xField, yField, groupField, title, xLabel, yLabel);
EvidenceTable(evidenceId, arrayPath, columns, title).
All arguments are positional. Use root = Stack([...]). Use only these seven components. No functions, actions, bindings, URLs, inline data or external requests. Each assignment must refer only to variables defined earlier. EvidenceChart and EvidenceTable read real data from the referenced successful execution's stdout JSON; do not embed measured numbers yourself. arrayPath is a dot-separated path to an array of flat objects, e.g. per_seed. xField and yField are numeric columns; groupField is a categorical/numeric field or empty string. Null measurements remain missing, never zero. Include units and limitations. Maximum 4 charts, 1 table, 20 KB total. If output has no suitable JSON rows, explain this in TextContent. Never describe generated UI as proof or replace the final Jev verdicts.`;

export function safeProgram(content: string): boolean {
  if (content.length > 20000 || content.split('\n').length > 100) return false;
  // Remove quoted strings before checking syntax. No bindings, functions, actions or expressions.
  const syntax = content.replace(/"(?:\\.|[^"\\])*"/g, '""');
  if (/[@$<>?{};]|\b(?:Query|Action|Image|Button|fetch|eval)\s*\(/.test(syntax)) return false;
  const calls = [...syntax.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]);
  const allowed = new Set(['Stack', 'Card', 'CardHeader', 'TextContent', 'EvidenceChart', 'EvidenceTable']);
  return /\broot\s*=\s*Stack\(/.test(syntax) && calls.every(c => allowed.has(c)) && calls.filter(c => c === 'EvidenceChart').length <= 4 && calls.filter(c => c === 'EvidenceTable').length <= 1;
}
export function extractViews(content: string): string[] {
  return [...content.matchAll(/```openui\s*\n([\s\S]*?)```/g)].map(m => m[1].trim()).filter(safeProgram).slice(0, 3);
}
export function executionRows(evidence: Evidence[], id: string, path: string): Record<string, unknown>[] {
  const item = evidence.find(e => e.id === id && e.status === 'passed' && e.metadata?.sandboxId);
  if (!item || !/^[a-zA-Z0-9_.]{1,100}$/.test(path)) return [];
  try {
    let value: unknown = JSON.parse(JSON.parse(item.content).stdout);
    for (const key of path.split('.')) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) return [];
      value = (value as Record<string, unknown>)[key];
    }
    return Array.isArray(value) && value.length <= 1000 && value.every(r => r && typeof r === 'object' && !Array.isArray(r)) ? value : [];
  } catch { return []; }
}
export function datasetCatalog(evidence: Evidence[]) {
  return evidence.filter(e => e.status === 'passed' && e.metadata?.sandboxId).flatMap(e => {
    try {
      const data = JSON.parse(JSON.parse(e.content).stdout);
      return Object.entries(data).filter(([, v]) => Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])).map(([path, v]) => ({ evidenceId: e.id, hash: e.hash, arrayPath: path, count: (v as unknown[]).length, columns: Object.keys((v as object[])[0]), sample: (v as unknown[]).slice(0, 2) }));
    } catch { return []; }
  });
}
