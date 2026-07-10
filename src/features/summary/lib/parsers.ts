// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
export function parseActionItems(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => /^[\-\*]\s*\[\s*\]/.test(l.trim()))
    .map((l) => l.trim().replace(/^[\-\*]\s*\[\s*\]\s*/, "").trim())
    .filter(Boolean);
}

export function parseTldr(md: string): string | null {
  const m = md.match(/##\s*tl[;:]?dr\s*\n+([\s\S]*?)(?=\n##|$)/i);
  return m ? m[1].trim() : null;
}
