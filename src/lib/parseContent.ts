// 問題文中の ```sql ... ``` フェンスをコードブロックとして抽出する（企画書3章: SQLは等幅+グレー背景で描画）
export interface ContentSegment {
  type: 'text' | 'code'
  value: string
}

const FENCE_RE = /```(?:sql)?\n?([\s\S]*?)```/g

export function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim()
      if (text) segments.push({ type: 'text', value: text })
    }
    segments.push({ type: 'code', value: match[1].replace(/\n$/, '') })
    lastIndex = FENCE_RE.lastIndex
  }
  const rest = content.slice(lastIndex).trim()
  if (rest) segments.push({ type: 'text', value: rest })
  if (segments.length === 0) segments.push({ type: 'text', value: content })
  return segments
}
