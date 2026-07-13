import type { QuestionType, SessionType } from '@/types/database'

export interface ChoiceDetail {
  id: string
  content: string
  is_correct: boolean
}

export interface QuestionImageDetail {
  id: string
  image_url: string
  image_type: 'QUESTION' | 'EXPLANATION'
  display_order: number
}

export interface QuestionDetail {
  id: string
  category_id: string | null
  content: string
  question_type: QuestionType
  explanation: string | null
  choices: ChoiceDetail[]
  images: QuestionImageDetail[]
}

export type QuestionState = 'untried' | 'miss' | 'hit'

export interface CategoryNode {
  id: string
  name: string
  count: number
  selected: boolean
}

// uuid主キーのため「ID順」に意味がないので、ランダム／未解答・古い解答優先の2種のみ提供
export type QuestionOrder = 'RANDOM' | 'LAST_ANSWERED'

export interface StartSessionOptions {
  sessionType: SessionType
  categoryIds: string[]
  states: QuestionState[]
  favoriteOnly: boolean
  order: QuestionOrder
}
