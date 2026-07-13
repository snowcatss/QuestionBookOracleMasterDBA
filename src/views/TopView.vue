<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { usePracticeStore } from '@/stores/practice'
import { createSession, createRetrySession } from '@/lib/session'
import { formatJaDateTime } from '@/lib/formatDate'
import StampSheet from '@/components/StampSheet.vue'
import type { UserStatsRow, SessionType } from '@/types/database'
import type { CategoryNode, QuestionState, QuestionOrder } from '@/types/domain'

const auth = useAuthStore()
const router = useRouter()
const practice = usePracticeStore()

const loading = ref(true)
const errorMessage = ref('')
const starting = ref(false)

const stats = ref<UserStatsRow | null>(null)
const showStamps = ref(true)
const mode = ref<SessionType>('PRACTICE')

const filters = ref<Record<QuestionState, boolean>>({ untried: true, miss: true, hit: false })
const favoriteOnly = ref(false)
const order = ref<QuestionOrder>('RANDOM')

const categories = ref<CategoryNode[]>([])
const selectedCount = computed(() => categories.value.filter((c) => c.selected && c.count > 0).length)

interface LastSession {
  id: string
  session_type: SessionType
  started_at: string
  status: string
}
const lastSession = ref<LastSession | null>(null)

const selectAll = (value: boolean) => {
  categories.value.forEach((c) => {
    if (c.count > 0) c.selected = value
  })
}

async function loadDashboard() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [{ data: statsData, error: statsError }, { data: catData, error: catError }, { data: sessionData }] =
      await Promise.all([
        supabase.rpc('get_user_stats'),
        supabase.rpc('get_category_counts'),
        supabase
          .from('exam_sessions')
          .select('id, session_type, started_at, status')
          .eq('user_id', auth.user!.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
    if (statsError) throw statsError
    if (catError) throw catError

    stats.value = statsData
    categories.value = (catData ?? []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
      count: Number(c.question_count),
      selected: false,
    }))
    lastSession.value = sessionData ?? null
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'データの取得に失敗しました'
  } finally {
    loading.value = false
  }
}

onMounted(loadDashboard)

async function startPractice() {
  const states = (Object.keys(filters.value) as QuestionState[]).filter((k) => filters.value[k])
  if (states.length === 0) {
    errorMessage.value = '出題対象を1つ以上選択してください'
    return
  }
  const categoryIds = categories.value.filter((c) => c.selected && c.count > 0).map((c) => c.id)
  starting.value = true
  errorMessage.value = ''
  try {
    const result = await createSession(auth.user!.id, {
      sessionType: mode.value,
      categoryIds,
      states,
      favoriteOnly: favoriteOnly.value,
      order: order.value,
    })
    if (result.questionIds.length === 0) {
      errorMessage.value = '条件に一致する問題がありません。フィルタや分野の選択を見直してください。'
      return
    }
    await practice.startSession({
      userId: auth.user!.id,
      sessionId: result.sessionId,
      sessionType: mode.value,
      questionIds: result.questionIds,
      timeLimitMinutes: result.timeLimitMinutes,
    })
    router.push('/question')
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'セッションの開始に失敗しました'
  } finally {
    starting.value = false
  }
}

async function retryMistakes() {
  if (!lastSession.value) return
  starting.value = true
  errorMessage.value = ''
  try {
    const result = await createRetrySession(auth.user!.id, lastSession.value.id)
    if (result.questionIds.length === 0) {
      errorMessage.value = '前回の演習にミスはありませんでした。'
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

const openLastResult = () => {
  if (lastSession.value) router.push(`/result/${lastSession.value.id}`)
}
</script>

<template>
  <div class="max-w-3xl mx-auto bg-white min-h-screen shadow-sm pb-28">
    <div v-if="loading" class="p-8 text-center text-gray-400 text-sm">読み込み中…</div>

    <template v-else>
      <p v-if="errorMessage" class="p-3 text-sm text-red-500 bg-red-50 border-b border-red-100">
        {{ errorMessage }}
      </p>

      <!-- 統計ヘッダー -->
      <div v-if="stats" class="flex justify-between text-center p-4 border-b">
        <div class="flex-1 border-b-4 border-gray-400 pb-2">
          <div class="text-xs font-bold text-gray-500">未出題</div>
          <div class="text-2xl font-bold text-gray-500">{{ stats.untried }}</div>
        </div>
        <div class="flex-1 border-b-4 border-red-500 pb-2">
          <div class="text-xs font-bold text-red-500">ミス</div>
          <div class="text-2xl font-bold text-red-500">{{ stats.miss }}</div>
        </div>
        <div class="flex-1 border-b-4 border-cyan-500 pb-2">
          <div class="text-xs font-bold text-cyan-500">ヒット</div>
          <div class="text-2xl font-bold text-cyan-500">{{ stats.hit }}</div>
        </div>
        <div class="flex-1 border-b-4 border-green-500 pb-2">
          <div class="text-xs font-bold text-green-500">コンボ</div>
          <div class="text-2xl font-bold text-green-500">{{ stats.combo }}</div>
        </div>
      </div>

      <!-- レベル + スタンプシート -->
      <div v-if="stats" class="px-4">
        <div class="flex justify-between items-center py-4">
          <div class="text-lg font-bold">
            レベル
            <span class="text-2xl text-cyan-500">{{ stats.level }}</span>
            <span class="text-sm text-cyan-500">/ {{ stats.max_level }}</span>
          </div>
          <button
            class="text-blue-500 text-sm hover:underline flex items-center"
            @click="showStamps = !showStamps"
          >
            <span class="mr-1 inline-block transition" :class="showStamps ? 'rotate-180' : ''">▲</span>
            スタンプシート
          </button>
        </div>

        <transition name="fade">
          <div v-if="showStamps" class="pb-4">
            <p class="text-sm text-gray-600 leading-relaxed mb-4">
              レベルはいろんな条件を達成するごとに上がっていきます。<br />
              達成した条件は以下のスタンプで確認できます。
            </p>
            <StampSheet :stats="stats" />
          </div>
        </transition>
      </div>

      <!-- 前回演習 -->
      <div v-if="lastSession" class="bg-gray-100 mx-4 p-4 rounded-xl text-center mb-6">
        <p class="text-sm text-gray-600 mb-3">
          前回の演習：
          {{ lastSession.session_type === 'MOCK_EXAM' ? '模擬試験' : '自由演習' }}
          {{ formatJaDateTime(lastSession.started_at) }}
        </p>
        <div class="flex justify-center gap-3">
          <button
            class="bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-full text-sm font-bold w-1/2 transition"
            @click="openLastResult"
          >
            演習結果
          </button>
          <button
            :disabled="starting"
            class="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-full text-sm font-bold w-1/2 transition"
            @click="retryMistakes"
          >
            ミスに再挑戦
          </button>
        </div>
      </div>

      <!-- モードタブ -->
      <div class="flex border-b border-gray-200 px-4">
        <button
          class="px-5 py-2 text-sm font-bold border-b-2 -mb-px transition"
          :class="
            mode === 'PRACTICE' ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          "
          @click="mode = 'PRACTICE'"
        >
          自由演習
        </button>
        <button
          class="px-5 py-2 text-sm font-bold border-b-2 -mb-px transition"
          :class="
            mode === 'MOCK_EXAM'
              ? 'border-cyan-500 text-cyan-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          "
          @click="mode = 'MOCK_EXAM'"
        >
          模擬試験
        </button>
      </div>

      <!-- 出題対象フィルタ -->
      <div class="bg-gray-50 p-4 border-b">
        <div class="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm mb-3">
          <span class="font-bold text-gray-700">出題対象</span>
          <label class="flex items-center"><input v-model="filters.untried" type="checkbox" class="mr-1" />未出題</label>
          <label class="flex items-center"><input v-model="filters.miss" type="checkbox" class="mr-1" />ミス</label>
          <label class="flex items-center"><input v-model="filters.hit" type="checkbox" class="mr-1" />ヒット</label>
        </div>
        <div class="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm">
          <label class="flex items-center text-blue-600">
            <input v-model="favoriteOnly" type="checkbox" class="mr-1" />☆ お気に入りで絞る
          </label>
          <label class="flex items-center gap-1 text-gray-600">
            出題順:
            <select v-model="order" class="border border-gray-300 rounded px-1 py-0.5 text-sm">
              <option value="RANDOM">ランダム</option>
              <option value="LAST_ANSWERED">未出題・古い解答を優先</option>
            </select>
          </label>
        </div>
      </div>

      <!-- 分野選択 -->
      <div class="p-4">
        <div class="flex gap-2 mb-3">
          <button
            class="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-xs font-bold transition"
            @click="selectAll(true)"
          >
            全分野選択
          </button>
          <button
            class="bg-gray-400 hover:bg-gray-500 text-white px-3 py-1 rounded text-xs font-bold transition"
            @click="selectAll(false)"
          >
            全分野解除
          </button>
        </div>

        <div class="border rounded-xl bg-white overflow-hidden text-sm">
          <div class="bg-gray-50 border-b px-4 py-2 font-bold text-gray-700">
            分野 <span class="text-gray-400 font-normal">（{{ stats?.total_questions ?? 0 }}問）</span>
          </div>
          <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label
              v-for="c in categories"
              :key="c.id"
              class="flex items-center text-gray-700 cursor-pointer"
              :class="c.count === 0 ? 'opacity-40' : ''"
            >
              <input v-model="c.selected" type="checkbox" :disabled="c.count === 0" class="mr-2" />
              {{ c.name }}
              <span class="text-gray-400 ml-1 code-block">{{ c.count }}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- ボトム固定ボタン -->
      <div class="fixed bottom-0 left-0 w-full bg-white border-t p-4 flex justify-center sticky-footer">
        <button
          :disabled="selectedCount === 0 || starting"
          class="w-full max-w-3xl py-3 rounded-full font-bold text-white transition"
          :class="selectedCount === 0 || starting ? 'bg-gray-300 cursor-not-allowed' : 'bg-cyan-500 hover:bg-cyan-600'"
          @click="startPractice"
        >
          {{
            selectedCount === 0
              ? '分野を選択してください'
              : (mode === 'MOCK_EXAM' ? '模擬試験を開始する' : '学習を開始する') + '（' + selectedCount + '分野選択中）'
          }}
        </button>
      </div>
    </template>
  </div>
</template>
