import path from 'path';

export function planRelativePath(key: string): string {
  return `nimbalyst-local/plans/${key}-plan.md`;
}

export function planAbsolutePath(workspacePath: string, key: string): string {
  return path.posix.join(workspacePath.replace(/\\/g, '/'), planRelativePath(key));
}

export function extractSummary(planMarkdown: string): string {
  const m = planMarkdown.match(/##\s+Summary\s*\n([\s\S]*?)\n##/m);
  if (m) return m[1].trim();
  // Check if Summary is at the end of document
  const m2 = planMarkdown.match(/##\s+Summary\s*\n([\s\S]*)/m);
  return m2 ? m2[1].trim() : '';
}

export function composeDescription(summary: string, planAbsPath: string): string {
  return `${summary}\n\n**Plan:** \`${planAbsPath}\``;
}
