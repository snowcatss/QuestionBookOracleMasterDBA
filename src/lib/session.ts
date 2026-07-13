import { supabase } from '@/lib/supabase'
import type { QuestionState, StartSessionOptions } from '@/types/domain'

interface CandidateQuestion {
  id: string
  lastAnsweredAt: string | null
}

async function classifyAndFilter(
  userId: string,
  categoryIds: string[],
  states: QuestionState[],
  favoriteOnly: boolean,
): Promise<CandidateQuestion[]> {
  if (categoryIds.length === 0 || states.length === 0) return []

  const { data: questionRows, error: qError } = await supabase
    .from('questions')
    .select('id')
    .in('category_id', categoryIds)
  if (qError) throw qError
  const allIds = (questionRows ?? []).map((r) => r.id)
  if (allIds.length === 0) return []

  const { data: statusRows, error: sError } = await supabase
    .from('user_question_status')
    .select('question_id, last_result, last_answered_at')
    .eq('user_id', userId)
    .in('question_id', allIds)
  if (sError) throw sError

  const statusMap = new Map<string, { lastResult: boolean; lastAnsweredAt: string | null }>()
  for (const row of statusRows ?? []) {
    statusMap.set(row.question_id, {
      lastResult: row.last_result,
      lastAnsweredAt: row.last_answered_at,
    })
  }

  let favoriteIds: Set<string> | null = null
  if (favoriteOnly) {
    const { data: favRows, error: fError } = await supabase
      .from('user_bookmarks')
      .select('question_id')
      .eq('user_id', userId)
      .eq('is_favorite', true)
      .in('question_id', allIds)
    if (fError) throw fError
    favoriteIds = new Set((favRows ?? []).map((r) => r.question_id))
  }

  const candidates: CandidateQuestion[] = []
  for (const id of allIds) {
    const status = statusMap.get(id)
    const state: QuestionState = !status ? 'untried' : status.lastResult ? 'hit' : 'miss'
    if (!states.includes(state)) continue
    if (favoriteIds && !favoriteIds.has(id)) continue
    candidates.push({ id, lastAnsweredAt: status?.lastAnsweredAt ?? null })
  }
  return candidates
}

function orderCandidates(candidates: CandidateQuestion[], order: StartSessionOptions['order']): string[] {
  if (order === 'RANDOM') {
    const arr = [...candidates]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr.map((c) => c.id)
  }
  // LAST_ANSWERED: 未解答（null）を最優先、その次に解答日時が古い順
  return [...candidates]
    .sort((a, b) => {
      if (a.lastAnsweredAt === b.lastAnsweredAt) return 0
      if (a.lastAnsweredAt === null) return -1
      if (b.lastAnsweredAt === null) return 1
      return a.lastAnsweredAt < b.lastAnsweredAt ? -1 : 1
    })
    .map((c) => c.id)
}

// 模試の目安時間: 1問あたり1.5分・最低10分（出題範囲を絞った少数問題でも演習として成立する簡易ロジック）
function estimateMockTimeLimit(questionCount: number): number {
  return Math.max(10, Math.round(questionCount * 1.5))
}

async function insertSessionQuestions(sessionId: string, questionIds: string[]) {
  if (questionIds.length === 0) return
  const rows = questionIds.map((questionId, index) => ({
    session_id: sessionId,
    question_id: questionId,
    display_order: index + 1,
  }))
  const { error } = await supabase.from('session_questions').insert(rows)
  if (error) throw error
}

export async function createSession(
  userId: string,
  options: StartSessionOptions,
): Promise<{ sessionId: string; questionIds: string[]; timeLimitMinutes: number | null }> {
  const candidates = await classifyAndFilter(userId, options.categoryIds, options.states, options.favoriteOnly)
  const questionIds = orderCandidates(candidates, options.order)
  const timeLimitMinutes = options.sessionType === 'MOCK_EXAM' ? estimateMockTimeLimit(questionIds.length) : null

  const { data: session, error: sessionError } = await supabase
    .from('exam_sessions')
    .insert({
      user_id: userId,
      session_type: options.sessionType,
      status: 'IN_PROGRESS',
      total_questions: questionIds.length,
      time_limit_minutes: timeLimitMinutes,
    })
    .select('id')
    .single()
  if (sessionError) throw sessionError

  await insertSessionQuestions(session.id, questionIds)

  return { sessionId: session.id, questionIds, timeLimitMinutes }
}

export async function createRetrySession(
  userId: string,
  sourceSessionId: string,
): Promise<{ sessionId: string; questionIds: string[] }> {
  const { data: answerRows, error } = await supabase
    .from('user_answers')
    .select('question_id, is_correct, answered_at')
    .eq('user_id', userId)
    .eq('exam_session_id', sourceSessionId)
    .order('answered_at', { ascending: true })
  if (error) throw error

  // 同じ問題を複数回解答している場合は最後の結果を採用する
  const lastResultByQuestion = new Map<string, boolean>()
  for (const row of answerRows ?? []) {
    lastResultByQuestion.set(row.question_id, row.is_correct)
  }
  const questionIds = [...lastResultByQuestion.entries()].filter(([, correct]) => !correct).map(([id]) => id)

  const { data: session, error: sessionError } = await supabase
    .from('exam_sessions')
    .insert({
      user_id: userId,
      session_type: 'PRACTICE',
      status: 'IN_PROGRESS',
      total_questions: questionIds.length,
    })
    .select('id')
    .single()
  if (sessionError) throw sessionError

  await insertSessionQuestions(session.id, questionIds)

  return { sessionId: session.id, questionIds }
}
