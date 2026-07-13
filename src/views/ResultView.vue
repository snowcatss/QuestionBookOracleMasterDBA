<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { usePracticeStore } from '@/stores/practice'
import { createRetrySession } from '@/lib/session'

const props = defineProps<{ sessionId: string }>()

const auth = useAuthStore()
const practice = usePracticeStore()
const router = useRouter()

const loading = ref(true)
const errorMessage = ref('')
const starting = ref(false)

interface ResultRow {
  questionId: string
  order: number
  correct: boolean
  preview: string
}
const resultRows = ref<ResultRow[]>([])

const resultCorrect = computed(() => resultRows.value.filter((r) => r.correct).length)
const resultTotal = computed(() => resultRows.value.length)
const correctRate = computed(() => (resultTotal.value === 0 ? 0 : Math.round((resultCorrect.value / resultTotal.value) * 100)))

async function loadResult() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [{ data: sqData, error: sqError }, { data: answerData, error: aError }] = await Promise.all([
      supabase
        .from('session_questions')
        .select('display_order, question_id, questions ( content )')
        .eq('session_id', props.sessionId)
        .order('display_order', { ascending: true }),
      supabase
        .from('user_answers')
        .select('question_id, is_correct, answered_at')
        .eq('user_id', auth.user!.id)
        .eq('exam_session_id', props.sessionId)
        .order('answered_at', { ascending: true }),
    ])
    if (sqError) throw sqError
    if (aError) throw aError

    const lastResultByQuestion = new Map<string, boolean>()
    for (const row of answerData ?? []) {
      lastResultByQuestion.set(row.question_id, row.is_correct)
    }

    resultRows.value = (sqData ?? []).map((row) => ({
      questionId: row.question_id,
      order: row.display_order,
      correct: lastResultByQuestion.get(row.question_id) ?? false,
      preview: (row.questions?.content ?? '').slice(0, 40) + '…',
    }))
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '結果の取得に失敗しました'
  } finally {
    loading.value = false
  }
}

onMounted(loadResult)

async function openQuestion(questionId: string) {
  starting.value = true
  errorMessage.value = ''
  try {
    const questionIds = resultRows.value.map((r) => r.questionId)
    const { data: answerData, error } = await supabase
      .from('user_answers')
      .select('question_id, is_correct, selected_choice_ids, answered_at')
      .eq('user_id', auth.user!.id)
      .eq('exam_session_id', props.sessionId)
      .order('answered_at', { ascending: true })
    if (error) throw error

    const lastAnswerByQuestion = new Map<string, { is_correct: boolean; selected_choice_ids: string[] }>()
    for (const row of answerData ?? []) {
      lastAnswerByQuestion.set(row.question_id, {
        is_correct: row.is_correct,
        selected_choice_ids: row.selected_choice_ids,
      })
    }

    await practice.startSession({
      userId: auth.user!.id,
      sessionId: props.sessionId,
      sessionType: 'PRACTICE',
      questionIds,
      timeLimitMinutes: null,
    })
    for (const qid of questionIds) {
      const ans = lastAnswerByQuestion.get(qid)
      if (ans) practice.markAsSubmitted(qid, ans.is_correct, ans.selected_choice_ids)
    }
    practice.goTo(questionIds.indexOf(questionId))
    router.push('/question')
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '問題の読み込みに失敗しました'
  } finally {
    starting.value = false
  }
}

async function retryMistakes() {
  starting.value = true
  errorMessage.value = ''
  try {
    const result = await createRetrySession(auth.user!.id, props.sessionId)
    if (result.questionIds.length === 0) {
      errorMessage.value = 'この演習にミスはありませんでした。'
      return
    }
    await practice.startSession({
      userId: auth.user!.id,
      sessionId: result.sessionId,
      sessionType: 'PRACTICE',
      questionIds: result.questionIds,
      timeLimitMinutes: null,
    })
    router.push('/question')
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '再挑戦の開始に失敗しました'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto bg-white min-h-screen relative pb-28 shadow-sm">
    <div class="text-center py-4 border-b font-bold text-gray-700 bg-gray-50">演習結果</div>

    <div v-if="loading" class="p-8 text-center text-gray-400 text-sm">読み込み中…</div>

    <template v-else>
      <p v-if="errorMessage" class="p-3 text-sm text-red-500 bg-red-50 border-b border-red-100">
        {{ errorMessage }}
      </p>

      <div class="p-6">
        <div class="text-center text-lg mb-8">
          正解は <span class="text-2xl font-bold text-cyan-500">{{ resultCorrect }}</span>
          <span class="font-bold">/ {{ resultTotal }}</span> 正答率
          <span class="text-2xl font-bold text-cyan-500">{{ correctRate }}%</span> でした
        </div>

        <div class="overflow-x-auto text-sm border-t border-gray-200">
          <table class="w-full text-left">
            <thead>
              <tr class="bg-gray-100 border-b text-gray-700">
                <th class="p-3 w-12 text-center">連番</th>
                <th class="p-3 w-12 text-center">正誤</th>
                <th class="p-3 w-20">ID</th>
                <th class="p-3">設問</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in resultRows"
                :key="r.questionId"
                class="border-b hover:bg-gray-50 cursor-pointer"
                @click="openQuestion(r.questionId)"
              >
                <td class="p-3 text-center">{{ r.order }}</td>
                <td class="p-3 text-center font-bold" :class="r.correct ? 'text-cyan-500' : 'text-red-500'">
                  {{ r.correct ? '○' : '×' }}
                </td>
                <td class="p-3 text-blue-500 code-block">{{ r.questionId.slice(0, 8) }}</td>
                <td class="p-3 text-gray-700 truncate max-w-[16rem]">{{ r.preview }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div class="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-3xl bg-white border-t p-4 flex justify-center gap-3 sticky-footer">
      <button
        class="bg-gray-500 hover:bg-gray-600 text-white w-1/2 py-3 rounded-full font-bold text-sm transition"
        @click="router.push('/')"
      >
        ← 学習履歴へ
      </button>
      <button
        :disabled="starting"
        class="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white w-1/2 py-3 rounded-full font-bold text-sm transition"
        @click="retryMistakes"
      >
        ミスに再挑戦
      </button>
    </div>
  </div>
</template>
