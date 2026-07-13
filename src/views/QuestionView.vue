<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePracticeStore } from '@/stores/practice'
import { parseContent } from '@/lib/parseContent'
import { formatJaDateTime } from '@/lib/formatDate'

const auth = useAuthStore()
const practice = usePracticeStore()
const router = useRouter()

if (practice.questionIds.length === 0) {
  router.replace('/')
}

const revealed = ref(false)
const lastCorrect = ref(false)
const revealing = ref(false)
const finishing = ref(false)
const memoOpen = ref(false)
const memoDraft = ref('')
const zoomedImage = ref<string | null>(null)

const q = computed(() => practice.currentQuestion)
const segments = computed(() => (q.value ? parseContent(q.value.content) : []))
const questionImages = computed(() => q.value?.images.filter((i) => i.image_type === 'QUESTION') ?? [])
const explanationImages = computed(() => q.value?.images.filter((i) => i.image_type === 'EXPLANATION') ?? [])
const shortId = computed(() => (q.value ? q.value.id.slice(0, 8) : ''))

const isMockExam = computed(() => practice.sessionType === 'MOCK_EXAM')

// --- 模擬試験タイマー ---
const remainingSeconds = ref(0)
let timerHandle: number | undefined
const timedOut = ref(false)

const timerLabel = computed(() => {
  const m = Math.floor(remainingSeconds.value / 60)
  const s = remainingSeconds.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

async function handleTimeout() {
  if (timedOut.value) return
  timedOut.value = true
  if (timerHandle) window.clearInterval(timerHandle)
  await practice.submitAllRemaining()
  await practice.finishSession(true)
  router.replace(`/result/${practice.sessionId}`)
}

function updateRemaining() {
  if (!practice.timeLimitMinutes || !practice.startedAt) return
  const elapsedSec = (Date.now() - practice.startedAt) / 1000
  const totalSec = practice.timeLimitMinutes * 60
  remainingSeconds.value = Math.max(0, Math.round(totalSec - elapsedSec))
  if (remainingSeconds.value <= 0) {
    handleTimeout()
  }
}

onMounted(() => {
  if (isMockExam.value) {
    updateRemaining()
    timerHandle = window.setInterval(updateRemaining, 1000)
  }
})
onUnmounted(() => {
  if (timerHandle) window.clearInterval(timerHandle)
})

// --- 選択肢 ---
const isSelected = (choiceId: string) => practice.isSelected(choiceId)
const toggleChoice = (choiceId: string) => {
  if (revealed.value) return
  practice.toggleChoice(choiceId)
}

const choiceClass = (choiceId: string, correct: boolean) => {
  if (!revealed.value) return isSelected(choiceId) ? 'border-cyan-400 bg-cyan-50' : 'border-transparent hover:bg-gray-50'
  if (correct) return 'border-cyan-400 bg-cyan-50'
  if (isSelected(choiceId) && !correct) return 'border-red-300 bg-red-50'
  return 'border-transparent'
}

// --- 正解・参考（自由演習のみ） ---
async function reveal() {
  if (revealed.value) {
    revealed.value = false
    return
  }
  revealing.value = true
  try {
    const result = await practice.submitCurrentAnswer()
    lastCorrect.value = !!result
    revealed.value = true
  } finally {
    revealing.value = false
  }
}

// --- ナビゲーション ---
async function nextQ() {
  if (finishing.value) return
  finishing.value = true
  try {
    await practice.submitCurrentAnswer()
    if (practice.isLastQuestion) {
      await practice.finishSession(false)
      router.replace(`/result/${practice.sessionId}`)
    } else {
      practice.goNext()
      revealed.value = false
    }
  } finally {
    finishing.value = false
  }
}
function prevQ() {
  if (practice.currentIndex > 0) {
    practice.goPrev()
    revealed.value = false
  }
}

function confirmQuit() {
  if (window.confirm('演習を終了してトップへ戻りますか？（ここまでの解答は記録されます）')) {
    router.push('/')
  }
}

// --- メモ・お気に入り ---
watch(
  () => practice.currentQuestionId,
  () => {
    memoDraft.value = practice.currentBookmark.memo
  },
  { immediate: true },
)

function openMemo() {
  memoDraft.value = practice.currentBookmark.memo
  memoOpen.value = true
}
async function saveMemo() {
  await practice.saveBookmark(auth.user!.id, practice.currentBookmark.isFavorite, memoDraft.value)
  memoOpen.value = false
}
async function toggleFavorite() {
  await practice.saveBookmark(auth.user!.id, !practice.currentBookmark.isFavorite, practice.currentBookmark.memo)
}
</script>

<template>
  <div v-if="q" class="max-w-3xl mx-auto bg-white min-h-screen relative pb-28 shadow-sm">
    <!-- ヘッダー -->
    <div
      class="text-white flex items-center px-4 py-2 text-sm font-bold"
      :class="isMockExam ? 'bg-yellow-600' : 'bg-cyan-600'"
    >
      <div class="flex-1">
        <template v-if="isMockExam">残り時間 <span class="code-block">{{ timerLabel }}</span></template>
        <template v-else>自由演習</template>
      </div>
      <span class="mr-4 text-xs opacity-90">{{ practice.currentIndex + 1 }} / {{ practice.questionIds.length }}</span>
      <button class="hover:opacity-80" @click="confirmQuit">× 終わる</button>
    </div>
    <div class="h-1 bg-gray-200">
      <div
        class="h-1 bg-cyan-400 transition-all"
        :style="{ width: ((practice.currentIndex + 1) / practice.questionIds.length) * 100 + '%' }"
      ></div>
    </div>

    <div class="p-6">
      <!-- メタデータ -->
      <div class="mb-6">
        <div class="text-gray-700 font-bold mb-2">
          問題ID ： <span class="text-lg code-block">{{ shortId }}</span>
          <span
            class="ml-2 text-xs font-normal px-2 py-0.5 rounded-full"
            :class="q.question_type === 'MULTIPLE' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'"
          >
            {{ q.question_type === 'MULTIPLE' ? '複数選択' : '単一選択' }}
          </span>
        </div>
        <div class="bg-gray-100 p-3 rounded-lg text-sm text-gray-600">
          <div class="flex items-center mb-1">
            <span class="w-12">履歴</span>
            <span
              v-for="(h, i) in practice.currentHistory.marks"
              :key="i"
              class="mx-1 font-bold"
              :class="h === '×' ? 'text-red-500' : h === '○' ? 'text-cyan-500' : ''"
              >{{ h }}</span
            >
          </div>
          <div>
            前回出題日時 ：
            {{ practice.currentHistory.lastAnsweredAt ? formatJaDateTime(practice.currentHistory.lastAnsweredAt) : '—' }}
          </div>
        </div>
      </div>

      <!-- 設問 -->
      <div class="text-gray-800 leading-relaxed mb-6">
        <template v-for="(seg, i) in segments" :key="i">
          <p v-if="seg.type === 'text'" class="mb-4 whitespace-pre-wrap">{{ seg.value }}</p>
          <div v-else class="code-block bg-gray-50 border p-4 rounded-lg text-sm overflow-x-auto whitespace-pre mb-4">{{
            seg.value
          }}</div>
        </template>

        <div v-if="questionImages.length" class="flex flex-wrap gap-3 mt-2">
          <img
            v-for="img in questionImages"
            :key="img.id"
            :src="img.image_url"
            alt="設問画像"
            class="max-h-40 rounded-lg border cursor-zoom-in hover:opacity-90"
            @click="zoomedImage = img.image_url"
          />
        </div>
      </div>

      <!-- 選択肢 -->
      <div class="space-y-2 mb-8">
        <label
          v-for="ch in q.choices"
          :key="ch.id"
          class="flex items-start p-2.5 rounded-lg cursor-pointer border transition"
          :class="choiceClass(ch.id, ch.is_correct)"
        >
          <input
            :type="q.question_type === 'MULTIPLE' ? 'checkbox' : 'radio'"
            :name="'q' + q.id"
            class="mt-1 mr-3"
            :checked="isSelected(ch.id)"
            @change="toggleChoice(ch.id)"
          />
          <span class="text-gray-700">{{ ch.content }}</span>
          <span v-if="revealed && ch.is_correct" class="ml-auto text-cyan-500 font-bold">正解</span>
        </label>
      </div>

      <!-- ナビゲーション -->
      <div class="flex gap-3 mb-6">
        <button
          :disabled="practice.currentIndex === 0"
          class="px-6 py-2 rounded-lg font-bold text-sm w-28 text-white transition"
          :class="practice.currentIndex === 0 ? 'bg-gray-300' : 'bg-cyan-500 hover:bg-cyan-600'"
          @click="prevQ"
        >
          ← もどる
        </button>
        <button
          :disabled="finishing"
          class="px-6 py-2 rounded-lg font-bold text-sm w-28 text-white bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 transition"
          @click="nextQ"
        >
          {{ practice.isLastQuestion ? '結果へ →' : 'すすむ →' }}
        </button>
      </div>

      <!-- 正解・参考（自由演習のみ） -->
      <div v-if="!isMockExam" class="space-y-3 border-t pt-6">
        <button
          :disabled="revealing"
          class="text-white px-6 py-2 rounded-lg font-bold text-sm w-28 bg-gray-500 hover:bg-gray-600 disabled:opacity-50 transition"
          @click="reveal"
        >
          {{ revealed ? '− 閉じる' : '＋ 正解' }}
        </button>

        <transition name="fade">
          <div
            v-if="revealed"
            class="mt-4 p-4 rounded-lg border"
            :class="lastCorrect ? 'bg-cyan-50 border-cyan-200' : 'bg-red-50 border-red-200'"
          >
            <div class="flex items-center gap-2 mb-3">
              <span class="text-lg font-bold" :class="lastCorrect ? 'text-cyan-600' : 'text-red-500'">
                {{ lastCorrect ? '○ 正解' : '× 不正解' }}
              </span>
            </div>
            <h3 class="font-bold text-gray-700 mb-1 text-sm">正解</h3>
            <p class="text-sm text-gray-700 mb-4">
              <span v-for="ch in q.choices.filter((c) => c.is_correct)" :key="ch.id" class="block"
                >・{{ ch.content }}</span
              >
            </p>
            <h3 class="font-bold text-gray-700 mb-1 text-sm">解説</h3>
            <p class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{{ q.explanation }}</p>
            <div v-if="explanationImages.length" class="flex flex-wrap gap-3 mt-3">
              <img
                v-for="img in explanationImages"
                :key="img.id"
                :src="img.image_url"
                alt="解説画像"
                class="max-h-40 rounded-lg border cursor-zoom-in hover:opacity-90"
                @click="zoomedImage = img.image_url"
              />
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- ボトム固定バー -->
    <div class="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-3xl bg-white border-t p-3 flex justify-between items-center sticky-footer">
      <button
        :disabled="practice.currentIndex === 0"
        class="w-14 h-14 rounded-lg flex flex-col justify-center items-center text-white transition"
        :class="practice.currentIndex === 0 ? 'bg-gray-300' : 'bg-cyan-500 hover:bg-cyan-600'"
        @click="prevQ"
      >
        <span class="font-bold">←</span><span class="text-xs">もどる</span>
      </button>
      <div class="flex gap-2">
        <button
          class="border border-gray-300 text-gray-600 px-4 py-2 rounded-full text-sm flex items-center hover:bg-gray-50 transition"
          @click="openMemo"
        >
          <span class="mr-1">✎</span> メモ<span
            v-if="practice.currentBookmark.memo"
            class="ml-1 w-2 h-2 rounded-full bg-cyan-500 inline-block"
          ></span>
        </button>
        <button
          class="border px-4 py-2 rounded-full text-sm flex items-center transition"
          :class="
            practice.currentBookmark.isFavorite
              ? 'border-yellow-400 text-yellow-500 bg-yellow-50'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          "
          @click="toggleFavorite"
        >
          <span class="mr-1">{{ practice.currentBookmark.isFavorite ? '★' : '☆' }}</span> お気に入り
        </button>
      </div>
      <button
        :disabled="finishing"
        class="w-14 h-14 rounded-lg flex flex-col justify-center items-center text-white bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 transition"
        @click="nextQ"
      >
        <span class="font-bold">→</span><span class="text-xs">すすむ</span>
      </button>
    </div>

    <!-- メモモーダル -->
    <div
      v-if="memoOpen"
      class="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4"
      @click.self="memoOpen = false"
    >
      <div class="bg-white w-full max-w-md rounded-xl p-5">
        <h3 class="font-bold mb-3">メモ（問題ID {{ shortId }}）</h3>
        <textarea
          v-model="memoDraft"
          rows="4"
          placeholder="この問題の覚え書き…"
          class="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:border-cyan-500"
        ></textarea>
        <div class="flex justify-end gap-2 mt-3">
          <button class="px-4 py-2 text-sm text-gray-500" @click="memoOpen = false">閉じる</button>
          <button
            class="px-4 py-2 text-sm text-white bg-cyan-500 hover:bg-cyan-600 rounded-lg font-bold transition"
            @click="saveMemo"
          >
            保存
          </button>
        </div>
      </div>
    </div>

    <!-- 画像拡大モーダル -->
    <div
      v-if="zoomedImage"
      class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      @click.self="zoomedImage = null"
    >
      <img :src="zoomedImage" alt="拡大画像" class="max-h-[90vh] max-w-full rounded-lg" />
    </div>
  </div>
</template>
