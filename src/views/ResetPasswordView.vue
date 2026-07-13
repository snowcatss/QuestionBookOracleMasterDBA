<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'

const router = useRouter()
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')

const handleUpdate = async () => {
  errorMessage.value = ''
  infoMessage.value = ''
  loading.value = true
  try {
    const { error } = await supabase.auth.updateUser({ password: password.value })
    if (error) throw error
    infoMessage.value = 'パスワードを更新しました。トップへ移動します…'
    setTimeout(() => router.push('/'), 1200)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '更新に失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
    <div class="w-full max-w-md bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <h1 class="text-xl font-bold mb-1">新しいパスワードを設定</h1>
      <p class="text-xs text-gray-400 mb-6">メールのリンクからアクセスした方はここでパスワードを再設定できます</p>

      <form @submit.prevent="handleUpdate">
        <label class="block text-sm text-gray-700 mb-1">新しいパスワード</label>
        <input
          v-model="password"
          type="password"
          required
          minlength="6"
          class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
        />

        <p v-if="errorMessage" class="text-sm text-red-500 mb-4">{{ errorMessage }}</p>
        <p v-if="infoMessage" class="text-sm text-cyan-600 mb-4">{{ infoMessage }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm transition"
        >
          {{ loading ? '更新中…' : 'パスワードを更新' }}
        </button>
      </form>
    </div>
  </div>
</template>
