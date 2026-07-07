const INVISIBLE_CONTROL_CHARS = /[\p{Cf}\u200B-\u200F\u2028-\u202F\uFEFF]/gu

const ALLOWED_NOTE_TAGS = new Set([
  'A',
  'BR',
  'CODE',
  'DIV',
  'EM',
  'I',
  'LI',
  'OL',
  'P',
  'STRONG',
  'U',
  'UL',
])

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export function sanitizeNoteHref(href: string): string {
  const trimmed = href.trim()
  const stripped = trimmed.replace(INVISIBLE_CONTROL_CHARS, '')
  const normalized = Array.from(stripped).filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join('').toLowerCase()
  if (
    normalized.startsWith('javascript:')
    || normalized.startsWith('data:')
    || normalized.startsWith('vbscript:')
    || normalized.startsWith('file:')
  ) {
    return '#'
  }
  return trimmed || '#'
}

export function renderMarkdown(md: string): string {
  return escapeHtml(md)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => `<a href="${sanitizeNoteHref(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.+<\/li>\n?)+/g, '<ul>$&</ul>')
}

function sanitizeNoteElement(node: Element): void {
  for (const child of Array.from(node.children)) {
    sanitizeNoteElement(child)
  }

  if (!ALLOWED_NOTE_TAGS.has(node.tagName)) {
    const replacement = node.ownerDocument.createTextNode(node.textContent ?? '')
    node.replaceWith(replacement)
    return
  }

  const rawHref = node.tagName === 'A' ? node.getAttribute('href') ?? '' : ''
  for (const attr of Array.from(node.attributes)) {
    node.removeAttribute(attr.name)
  }

  if (node.tagName === 'A') {
    node.setAttribute('href', sanitizeNoteHref(rawHref))
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
}

export function sanitizeNoteHtml(html: string): string {
  if (!html.trim()) return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''
  sanitizeNoteElement(root)
  return root.innerHTML
}

export function prepareNoteContent(raw: string): string {
  if (!raw) return ''
  if (/^\s*</.test(raw)) return sanitizeNoteHtml(raw)
  return sanitizeNoteHtml(renderMarkdown(raw))
}

export function buildCodeBlockHtml(text: string): string {
  return `<code>${escapeHtml(text)}</code>`
}
