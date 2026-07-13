// supabase_schema.sql に基づく手書き型定義（CLI未接続のため手動管理）。
// スキーマを変更したらこのファイルも合わせて更新すること。

export type QuestionType = 'SINGLE' | 'MULTIPLE'
export type SessionType = 'PRACTICE' | 'MOCK_EXAM'
export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED'
export type ImageType = 'QUESTION' | 'EXPLANATION'

// @supabase/postgrest-js の GenericTable は Relationships フィールドを要求するため、
// select() の embed（例: questions(choices(*))）が正しく型推論されるように明示する。

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string | null
          current_combo: number
          total_answered: number
          total_correct: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username?: string | null
        }
        Update: {
          username?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          parent_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      questions: {
        Row: {
          id: string
          category_id: string | null
          content: string
          question_type: QuestionType
          explanation: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id?: string | null
          content: string
          question_type: QuestionType
          explanation?: string | null
        }
        Update: Partial<Database['public']['Tables']['questions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'questions_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      question_images: {
        Row: {
          id: string
          question_id: string | null
          image_url: string
          image_type: ImageType
          display_order: number | null
          created_at: string
        }
        Insert: {
          id?: string
          question_id?: string | null
          image_url: string
          image_type: ImageType
          display_order?: number | null
        }
        Update: Partial<Database['public']['Tables']['question_images']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'question_images_question_id_fkey'
            columns: ['question_id']
            isOneToOne: false
            referencedRelation: 'questions'
            referencedColumns: ['id']
          },
        ]
      }
      choices: {
        Row: {
          id: string
          question_id: string | null
          content: string
          is_correct: boolean
        }
        Insert: {
          id?: string
          question_id?: string | null
          content: string
          is_correct?: boolean
        }
        Update: Partial<Database['public']['Tables']['choices']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'choices_question_id_fkey'
            columns: ['question_id']
            isOneToOne: false
            referencedRelation: 'questions'
            referencedColumns: ['id']
          },
        ]
      }
      exam_sessions: {
        Row: {
          id: string
          user_id: string
          session_type: SessionType
          status: SessionStatus
          score: number | null
          total_questions: number | null
          time_limit_minutes: number | null
          is_timeout: boolean
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          session_type: SessionType
          status?: SessionStatus
          score?: number | null
          total_questions?: number | null
          time_limit_minutes?: number | null
          is_timeout?: boolean
          completed_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['exam_sessions']['Insert']>
        Relationships: []
      }
      session_questions: {
        Row: {
          id: string
          session_id: string
          question_id: string
          display_order: number
        }
        Insert: {
          id?: string
          session_id: string
          question_id: string
          display_order?: number
        }
        Update: Partial<Database['public']['Tables']['session_questions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'session_questions_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'exam_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'session_questions_question_id_fkey'
            columns: ['question_id']
            isOneToOne: false
            referencedRelation: 'questions'
            referencedColumns: ['id']
          },
        ]
      }
      user_answers: {
        Row: {
          id: string
          user_id: string
          question_id: string
          exam_session_id: string | null
          selected_choice_ids: string[]
          is_correct: boolean
          answered_at: string
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          exam_session_id?: string | null
          selected_choice_ids: string[]
          is_correct: boolean
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'user_answers_question_id_fkey'
            columns: ['question_id']
            isOneToOne: false
            referencedRelation: 'questions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_answers_exam_session_id_fkey'
            columns: ['exam_session_id']
            isOneToOne: false
            referencedRelation: 'exam_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      user_question_status: {
        Row: {
          user_id: string
          question_id: string
          last_result: boolean
          correct_count: number
          wrong_count: number
          last_answered_at: string | null
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'user_question_status_question_id_fkey'
            columns: ['question_id']
            isOneToOne: false
            referencedRelation: 'questions'
            referencedColumns: ['id']
          },
        ]
      }
      user_bookmarks: {
        Row: {
          user_id: string
          question_id: string
          is_favorite: boolean
          memo: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          question_id: string
          is_favorite?: boolean
          memo?: string | null
        }
        Update: Partial<Database['public']['Tables']['user_bookmarks']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'user_bookmarks_question_id_fkey'
            columns: ['question_id']
            isOneToOne: false
            referencedRelation: 'questions'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      submit_answer: {
        Args: {
          p_question_id: string
          p_selected_choice_ids: string[]
          p_session_id?: string | null
        }
        Returns: boolean
      }
      get_user_stats: {
        Args: Record<string, never>
        Returns: UserStatsRow
      }
      get_category_counts: {
        Args: Record<string, never>
        Returns: CategoryCountRow[]
      }
    }
  }
}

// get_user_stats() RPC が返す JSON の形（企画書 4-3, 4-4 の集計値）
export interface UserStatsRow {
  total_questions: number
  untried: number
  miss: number
  hit: number
  combo: number
  hit_pct: number
  combo_pct: number
  hit_stamps: number
  combo_stamps: number
  mock80_stamps: number
  mock90_stamps: number
  level: number
  max_level: number
}

// get_category_counts() RPC の行の形
export interface CategoryCountRow {
  category_id: string
  category_name: string
  question_count: number
}
