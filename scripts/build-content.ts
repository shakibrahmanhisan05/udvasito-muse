/**
 * content:build (CLAUDE.md §4) — src/content/*.md → src/content/generated/*.json
 * for CMP-Markdown. Supports only the specs §1.3.5 subset: ##/### headings,
 * paragraphs, bullet/numbered lists, **bold**, *italic*, links. Frontmatter
 * (--- version/effective/reviewedBy ---, roadmap §5.4) is carried through.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

export function markdownToBlocks(md: string): { meta: Record<string, string>; blocks: Block[] } {
  const meta: Record<string, string> = {};
  let body = md;
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    body = md.slice(fm[0].length);
  }
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("### ")) { flush(); blocks.push({ type: "heading", level: 3, text: line.slice(4) }); continue; }
    if (line.startsWith("## ")) { flush(); blocks.push({ type: "heading", level: 2, text: line.slice(3) }); continue; }
    const bullet = line.match(/^[-*] (.+)$/);
    const numbered = line.match(/^\d+\. (.+)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    blocks.push({ type: "paragraph", text: line });
  }
  flush();
  return { meta, blocks };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

const srcRoot = join(process.cwd(), "src/content");
const outRoot = join(srcRoot, "generated");
mkdirSync(outRoot, { recursive: true });
const files = walk(srcRoot).filter((f) => !f.includes("generated"));
for (const file of files) {
  const { meta, blocks } = markdownToBlocks(readFileSync(file, "utf8"));
  const rel = relative(srcRoot, file).replace(/\.md$/, ".json");
  const out = join(outRoot, rel);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, JSON.stringify({ meta, blocks }, null, 2));
  console.log(`content:build — ${rel} (${blocks.length} blocks)`);
}
console.log(`content:build — ${files.length} file(s)`);
