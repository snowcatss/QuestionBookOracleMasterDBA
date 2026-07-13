<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

type Mode = 'login' | 'signup' | 'forgot' | 'resend'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref<Mode>('login')
const email = ref('')
const password = ref('')
const username = ref('')
const remember = ref(true)
const loading = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')

const resetMessages = () => {
  errorMessage.value = ''
  infoMessage.value = ''
}

const switchMode = (next: Mode) => {
  mode.value = next
  resetMessages()
}

const handleLogin = async () => {
  resetMessages()
  loading.value = true
  try {
    await auth.signIn(email.value, password.value, remember.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.push(redirect)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'ログインに失敗しました'
  } finally {
    loading.value = false
  }
}

const handleSignup = async () => {
  resetMessages()
  loading.value = true
  try {
    await auth.signUp(email.value, password.value, username.value)
    infoMessage.value = '確認メールを送信しました。メール内のリンクから登録を完了してください。'
    mode.value = 'login'
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '登録に失敗しました'
  } finally {
    loading.value = false
  }
}

const handleForgot = async () => {
  resetMessages()
  loading.value = true
  try {
    await auth.resetPassword(email.value)
    infoMessage.value = 'パスワード再設定用のメールを送信しました。'
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '送信に失敗しました'
  } finally {
    loading.value = false
  }
}

const handleResend = async () => {
  resetMessages()
  loading.value = true
  try {
    await auth.resendConfirmation(email.value)
    infoMessage.value = '確認メールを再送信しました。'
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '送信に失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
    <div class="w-full max-w-md bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <template v-if="mode === 'login'">
        <h1 class="text-xl font-bold mb-1">ログイン</h1>
        <p class="text-xs text-gray-400 mb-6">ORACLE MASTER Gold DBA 2019 問題集</p>

        <form @submit.prevent="handleLogin">
          <label class="block text-sm text-gray-700 mb-1">Eメール</label>
          <input
            v-model="email"
            type="email"
            required
            placeholder="Eメールでログインしてください"
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <label class="block text-sm text-gray-700 mb-1">パスワード</label>
          <input
            v-model="password"
            type="password"
            required
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <label class="flex items-center mb-4 text-sm text-gray-700 select-none">
            <input v-model="remember" type="checkbox" class="mr-2" /> ログインを記憶する
          </label>

          <p v-if="errorMessage" class="text-sm text-red-500 mb-4">{{ errorMessage }}</p>
          <p v-if="infoMessage" class="text-sm text-cyan-600 mb-4">{{ infoMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm transition"
          >
            {{ loading ? 'ログイン中…' : 'ログイン' }}
          </button>
        </form>

        <div class="mt-8 space-y-2 text-sm">
          <a href="#" class="block text-blue-500 hover:underline" @click.prevent="switchMode('signup')"
            >新規ユーザー登録はこちら</a
          >
          <a href="#" class="block text-blue-500 hover:underline" @click.prevent="switchMode('forgot')"
            >パスワードを忘れた方はこちら</a
          >
          <a href="#" class="block text-blue-500 hover:underline" @click.prevent="switchMode('resend')"
            >確認メールを受け取っていませんか？</a
          >
        </div>
      </template>

      <template v-else-if="mode === 'signup'">
        <h1 class="text-xl font-bold mb-1">新規登録</h1>
        <p class="text-xs text-gray-400 mb-6">ORACLE MASTER Gold DBA 2019 問題集</p>

        <form @submit.prevent="handleSignup">
          <label class="block text-sm text-gray-700 mb-1">ユーザー名</label>
          <input
            v-model="username"
            type="text"
            required
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <label class="block text-sm text-gray-700 mb-1">Eメール</label>
          <input
            v-model="email"
            type="email"
            required
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <label class="block text-sm text-gray-700 mb-1">パスワード</label>
          <input
            v-model="password"
            type="password"
            required
            minlength="6"
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <p v-if="errorMessage" class="text-sm text-red-500 mb-4">{{ errorMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm transition"
          >
            {{ loading ? '登録中…' : '登録する' }}
          </button>
        </form>

        <a href="#" class="block mt-6 text-sm text-blue-500 hover:underline" @click.prevent="switchMode('login')"
          >← ログインへ戻る</a
        >
      </template>

      <template v-else-if="mode === 'forgot'">
        <h1 class="text-xl font-bold mb-1">パスワード再設定</h1>
        <p class="text-xs text-gray-400 mb-6">登録済みのEメールに再設定用リンクを送ります</p>

        <form @submit.prevent="handleForgot">
          <label class="block text-sm text-gray-700 mb-1">Eメール</label>
          <input
            v-model="email"
            type="email"
            required
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <p v-if="errorMessage" class="text-sm text-red-500 mb-4">{{ errorMessage }}</p>
          <p v-if="infoMessage" class="text-sm text-cyan-600 mb-4">{{ infoMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm transition"
          >
            {{ loading ? '送信中…' : '再設定メールを送る' }}
          </button>
        </form>

        <a href="#" class="block mt-6 text-sm text-blue-500 hover:underline" @click.prevent="switchMode('login')"
          >← ログインへ戻る</a
        >
      </template>

      <template v-else-if="mode === 'resend'">
        <h1 class="text-xl font-bold mb-1">確認メール再送信</h1>
        <p class="text-xs text-gray-400 mb-6">登録時のEメールに確認リンクを再送します</p>

        <form @submit.prevent="handleResend">
          <label class="block text-sm text-gray-700 mb-1">Eメール</label>
          <input
            v-model="email"
            type="email"
            required
            class="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
          />

          <p v-if="errorMessage" class="text-sm text-red-500 mb-4">{{ errorMessage }}</p>
          <p v-if="infoMessage" class="text-sm text-cyan-600 mb-4">{{ infoMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm transition"
          >
            {{ loading ? '送信中…' : '確認メールを再送信' }}
          </button>
        </form>

        <a href="#" class="block mt-6 text-sm text-blue-500 hover:underline" @click.prevent="switchMode('login')"
          >← ログインへ戻る</a
        >
      </template>
    </div>
  </div>
</template>
