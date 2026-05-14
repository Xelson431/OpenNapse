export const IDEA_DRAG_MIME = 'application/x-OpenNapse-idea'

export type IdeaDragPayload = { ideaId: string }

export function hasIdeaDragPayload(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(IDEA_DRAG_MIME)
}

export function readIdeaDragPayload(dataTransfer: DataTransfer): IdeaDragPayload | null {
  const raw = dataTransfer.getData(IDEA_DRAG_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<IdeaDragPayload>
    return typeof parsed.ideaId === 'string' ? { ideaId: parsed.ideaId } : null
  } catch {
    return null
  }
}
