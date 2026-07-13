<script setup lang="ts">
// 認証初期化は router.beforeEach（router/index.ts）内で一度だけ実行する。
// ここで重複して呼ぶと onAuthStateChange リスナーが二重登録される。
</script>

<template>
  <RouterView />
</template>
