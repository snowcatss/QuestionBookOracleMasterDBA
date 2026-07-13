import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { QuestionDetail } from '@/types/domain'
import type { SessionType } from '@/types/database'

export const usePracticeStore = defineStore('practice', () => {
  const sessionId = ref<string | null>(null)
  const sessionType = ref<SessionType>('PRACTICE')
  const timeLimitMinutes = ref<number | null>(null)
  const startedAt = ref<number | null>(null)

  const questionIds = ref<string[]>([])
  const questions = ref<Map<string, QuestionDetail>>(new Map())
  const currentIndex = ref(0)
  const selections = ref<Map<string, string[]>>(new Map())
  const revealedResults = ref<Map<string, boolean>>(new Map())
  const submittedQuestionIds = ref<Set<string>>(new Set())
  const historyMap = ref<Map<string, { marks: string[]; lastAnsweredAt: string | null }>>(new Map())

  const currentQuestionId = computed(() => questionIds.value[currentIndex.value] ?? null)
  const currentQuestion = computed(() =>
    currentQuestionId.value ? (questions.value.get(currentQuestionId.value) ?? null) : null,
  )
  const emptyHistory = { marks: ['—', '—', '—', '—', '—'], lastAnsweredAt: null }
  const currentHistory = computed(() => {
    if (!currentQuestionId.value) return emptyHistory
    return historyMap.value.get(currentQuestionId.value) ?? emptyHistory
  })
  const isLastQuestion = computed(() => currentIndex.value === questionIds.value.length - 1)
  const score = computed(() => [...revealedResults.value.values()].filter(Boolean).length)

  async function loadHistory(userId: string, ids: string[]) {
    if (ids.length === 0) return
    const { data, error } = await supabase
      .from('user_answers')
      .select('question_id, is_correct, answered_at')
      .eq('user_id', userId)
      .in('question_id', ids)
      .order('answered_at', { ascending: true })
    if (error) throw error

    const grouped = new Map<string, { is_correct: boolean; answered_at: string }[]>()
    for (const row of data ?? []) {
      const arr = grouped.get(row.question_id) ?? []
      arr.push({ is_correct: row.is_correct, answered_at: row.answered_at })
      grouped.set(row.question_id, arr)
    }

    const map = new Map<string, { marks: string[]; lastAnsweredAt: string | null }>()
    for (const [qid, arr] of grouped) {
      const marks: string[] = arr.slice(-5).map((a) => (a.is_correct ? '○' : '×'))
      while (marks.length < 5) marks.push('—')
      map.set(qid, { marks, lastAnsweredAt: arr[arr.length - 1].answered_at })
    }
    historyMap.value = map
  }

  const bookmarksMap = ref<Map<string, { isFavorite: boolean; memo: string }>>(new Map())
  const emptyBookmark = { isFavorite: false, memo: '' }
  const currentBookmark = computed(() => {
    if (!currentQuestionId.value) return emptyBookmark
    return bookmarksMap.value.get(currentQuestionId.value) ?? emptyBookmark
  })

  async function loadBookmarks(userId: string, ids: string[]) {
    if (ids.length === 0) return
    const { data, error } = await supabase
      .from('user_bookmarks')
      .select('question_id, is_favorite, memo')
      .eq('user_id', userId)
      .in('question_id', ids)
    if (error) throw error
    const map = new Map<string, { isFavorite: boolean; memo: string }>()
    for (const row of data ?? []) {
      map.set(row.question_id, { isFavorite: row.is_favorite ?? false, memo: row.memo ?? '' })
    }
    bookmarksMap.value = map
  }

  async function saveBookmark(userId: string, isFavorite: boolean, memo: string) {
    const qid = currentQuestionId.value
    if (!qid) return
    const { error } = await supabase
      .from('user_bookmarks')
      .upsert({ user_id: userId, question_id: qid, is_favorite: isFavorite, memo })
    if (error) throw error
    bookmarksMap.value.set(qid, { isFavorite, memo })
  }

  async function loadQuestionDetails(ids: string[]) {
    if (ids.length === 0) return
    const { data, error } = await supabase
      .from('questions')
      .select(
        `id, category_id, content, question_type, explanation,
         choices ( id, content, is_correct ),
         question_images ( id, image_url, image_type, display_order )`,
      )
      .in('id', ids)
    if (error) throw error
    for (const row of data ?? []) {
      const images = [...(row.question_images ?? [])]
        .map((img) => ({ ...img, display_order: img.display_order ?? 0 }))
        .sort((a, b) => a.display_order - b.display_order)
      questions.value.set(row.id, {
        id: row.id,
        category_id: row.category_id,
        content: row.content,
        question_type: row.question_type,
        explanation: row.explanation,
        choices: row.choices ?? [],
        images,
      })
    }
  }

  async function startSession(params: {
    userId: string
    sessionId: string
    sessionType: SessionType
    questionIds: string[]
    timeLimitMinutes: number | null
  }) {
    sessionId.value = params.sessionId
    sessionType.value = params.sessionType
    questionIds.value = params.questionIds
    timeLimitMinutes.value = params.timeLimitMinutes
    startedAt.value = Date.now()
    currentIndex.value = 0
    selections.value = new Map()
    revealedResults.value = new Map()
    submittedQuestionIds.value = new Set()
    questions.value = new Map()
    historyMap.value = new Map()
    bookmarksMap.value = new Map()
    await Promise.all([
      loadQuestionDetails(params.questionIds),
      loadHistory(params.userId, params.questionIds),
      loadBookmarks(params.userId, params.questionIds),
    ])
  }

  function toggleChoice(choiceId: string) {
    const q = currentQuestion.value
    if (!q) return
    const qid = q.id
    const current = selections.value.get(qid) ?? []
    if (q.question_type === 'SINGLE') {
      selections.value.set(qid, [choiceId])
    } else {
      const idx = current.indexOf(choiceId)
      const next = [...current]
      if (idx >= 0) next.splice(idx, 1)
      else next.push(choiceId)
      selections.value.set(qid, next)
    }
  }

  function isSelected(choiceId: string): boolean {
    const q = currentQuestion.value
    if (!q) return false
    return (selections.value.get(q.id) ?? []).includes(choiceId)
  }

  async function submitQuestionIfNeeded(questionId: string): Promise<boolean | null> {
    if (submittedQuestionIds.value.has(questionId)) {
      return revealedResults.value.get(questionId) ?? null
    }
    if (!sessionId.value) throw new Error('no active session')
    const selected = selections.value.get(questionId) ?? []
    const { data, error } = await supabase.rpc('submit_answer', {
      p_question_id: questionId,
      p_selected_choice_ids: selected,
      p_session_id: sessionId.value,
    })
    if (error) throw error
    submittedQuestionIds.value.add(questionId)
    revealedResults.value.set(questionId, data)
    return data
  }

  async function submitCurrentAnswer(): Promise<boolean | null> {
    const q = currentQuestion.value
    if (!q) throw new Error('no active question')
    return submitQuestionIfNeeded(q.id)
  }

  async function submitAllRemaining() {
    for (const id of questionIds.value) {
      await submitQuestionIfNeeded(id)
    }
  }

  function markAsSubmitted(questionId: string, isCorrect: boolean, selectedChoiceIds: string[]) {
    submittedQuestionIds.value.add(questionId)
    revealedResults.value.set(questionId, isCorrect)
    selections.value.set(questionId, selectedChoiceIds)
  }

  function goNext() {
    if (currentIndex.value < questionIds.value.length - 1) currentIndex.value++
  }
  function goPrev() {
    if (currentIndex.value > 0) currentIndex.value--
  }
  function goTo(index: number) {
    if (index >= 0 && index < questionIds.value.length) currentIndex.value = index
  }

  async function finishSession(isTimeout = false) {
    if (!sessionId.value) return
    const { error } = await supabase
      .from('exam_sessions')
      .update({
        status: 'COMPLETED',
        score: score.value,
        completed_at: new Date().toISOString(),
        is_timeout: isTimeout,
      })
      .eq('id', sessionId.value)
    if (error) throw error
  }

  function reset() {
    sessionId.value = null
    questionIds.value = []
    questions.value = new Map()
    currentIndex.value = 0
    selections.value = new Map()
    revealedResults.value = new Map()
    submittedQuestionIds.value = new Set()
  }

  return {
    sessionId,
    sessionType,
    timeLimitMinutes,
    startedAt,
    questionIds,
    questions,
    currentIndex,
    currentQuestionId,
    currentQuestion,
    currentHistory,
    isLastQuestion,
    score,
    selections,
    revealedResults,
    submittedQuestionIds,
    currentBookmark,
    startSession,
    toggleChoice,
    isSelected,
    submitCurrentAnswer,
    submitAllRemaining,
    saveBookmark,
    markAsSubmitted,
    goNext,
    goPrev,
    goTo,
    finishSession,
    reset,
  }
})
