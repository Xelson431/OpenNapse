import { describe, expect, it } from 'vitest'
import { buildCodeBlockHtml, prepareNoteContent, renderMarkdown, sanitizeNoteHref, sanitizeNoteHtml } from './note-html'

describe('note html sanitization', () => {
  it('blocks dangerous link schemes', () => {
    expect(sanitizeNoteHref('javascript:alert(1)')).toBe('#')
    expect(sanitizeNoteHref(' data:text/html,<svg onload=1>')).toBe('#')
    expect(sanitizeNoteHref('https://example.com')).toBe('https://example.com')
  })

  it('sanitizes hostile html before rendering saved notes', () => {
    const sanitized = sanitizeNoteHtml('<img src=x onerror=alert(1)><a href="javascript:alert(1)" onclick="boom()">Click</a><strong data-x="1">safe</strong>')
    expect(sanitized).not.toContain('<img')
    expect(sanitized).not.toContain('onerror')
    expect(sanitized).not.toContain('onclick')
    expect(sanitized).toContain('href="#"')
    expect(sanitized).toContain('<strong>safe</strong>')
  })

  it('sanitizes markdown output before use in the editor', () => {
    const prepared = prepareNoteContent('[click](javascript:alert(1))')
    expect(prepared).toContain('href="#"')
    expect(prepared).toContain('rel="noopener noreferrer"')
  })

  it('escapes inserted code snippets', () => {
    expect(buildCodeBlockHtml('<img src=x onerror=1>')).toBe('<code>&lt;img src=x onerror=1&gt;</code>')
  })

  it('keeps expected markdown formatting', () => {
    expect(renderMarkdown('**bold** *italic* `code`')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('**bold** *italic* `code`')).toContain('<em>italic</em>')
    expect(renderMarkdown('**bold** *italic* `code`')).toContain('<code>code</code>')
  })
})
