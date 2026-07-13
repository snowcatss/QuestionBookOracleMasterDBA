// 「ログインを記憶する」の実装。
// remember=true: localStorage（ブラウザを閉じても継続）
// remember=false: sessionStorage（タブを閉じたら消える）
const REMEMBER_KEY = 'auth-remember-me'

function activeStorage(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === 'false' ? sessionStorage : localStorage
}

export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false')
  if (remember) {
    sessionStorage.clear()
  } else {
    localStorage.removeItem(REMEMBER_KEY)
    localStorage.setItem(REMEMBER_KEY, 'false')
  }
}

export const authStorage = {
  getItem: (key: string) => activeStorage().getItem(key),
  setItem: (key: string, value: string) => activeStorage().setItem(key, value),
  removeItem: (key: string) => activeStorage().removeItem(key),
}
