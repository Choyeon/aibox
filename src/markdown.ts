// 轻量 Markdown 渲染：代码块 / 行内代码 / 粗体 / 斜体 / 标题 / 列表 / 链接
// 足够覆盖 AI 回复的常见格式，不引入大型依赖。输入需为已转义文本。
export function renderMarkdown(escaped: string): string {
  const lines = escaped.split("\n");
  let out = "";
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let inList = false;

  const inline = (s: string) =>
    s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
     .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
     .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
     .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  for (const line of lines) {
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      if (!inCode) { inCode = true; codeLang = fence[1] || ""; codeBuf = []; }
      else {
        out += `<div class="md-block"><div class="md-block-head">${codeLang || "代码"}<button class="md-copy" data-code="${encodeURIComponent(codeBuf.join("\n"))}">复制</button></div><pre><code>${codeBuf.join("\n")}</code></pre></div>`;
        inCode = false; codeBuf = [];
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { if (inList) { out += "</ul>"; inList = false; } out += `<h${h[1].length} class="md-h">${inline(h[2])}</h${h[1].length}>`; continue; }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { out += "<ul class=\"md-ul\">"; inList = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }

    if (!line.trim()) { out += '<div class="md-br"></div>'; continue; }
    out += `<div class="md-p">${inline(line)}</div>`;
  }
  if (inCode) out += `<div class="md-block"><pre><code>${codeBuf.join("\n")}</code></pre></div>`;
  if (inList) out += "</ul>";
  return out;
}
