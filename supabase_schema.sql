-- ============================================================
-- ORACLE MASTER Gold DBA 2019 問題集スキーマ（改訂版）
-- 変更点:
--   - exam_sessions に total_questions 追加
--   - session_questions テーブル新規追加（出題順の保存）
--   - user_question_status テーブル新規追加（未出題/ミス/ヒットの集約）
--   - handle_new_user トリガ追加
--   - submit_answer() 採点＋統計更新 RPC 追加
--   - get_user_stats() レベル・スタンプ算出 RPC 追加
--   - get_category_counts() 分野別問題数 RPC 追加
--   - RLS に INSERT 用 WITH CHECK を明示
-- 前提: 全問題数 N = 全 questions 件数（単一資格アプリ前提）
-- ============================================================

-- ------------------------------------------------------------
-- 拡張
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- 1. Profiles（ユーザープロフィール・統計）
--    current_combo のみ状態として保持。level 等は集計から算出。
-- ============================================================
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username VARCHAR(255),
    current_combo INTEGER NOT NULL DEFAULT 0,   -- 現在の連続正解数（不正解で0）
    total_answered INTEGER NOT NULL DEFAULT 0,  -- 累計解答数（延べ）
    total_correct INTEGER NOT NULL DEFAULT 0,   -- 累計正解数（延べ）
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. Categories（階層型カテゴリ）
--    親: ORACLE GOLD DBA 2019 / 子: 各分野
-- ============================================================
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. Questions（問題）
-- ============================================================
CREATE TABLE public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    content TEXT NOT NULL,                       -- 設問（SQLコードブロック含む）
    question_type VARCHAR(50) NOT NULL CHECK (question_type IN ('SINGLE', 'MULTIPLE')),
    explanation TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3.5 Question Images（問題・解説用の画像。1問に複数可）
-- ============================================================
CREATE TABLE public.question_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    image_type VARCHAR(50) NOT NULL CHECK (image_type IN ('QUESTION', 'EXPLANATION')),
    display_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. Choices（選択肢）
-- ============================================================
CREATE TABLE public.choices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- 5. Exam Sessions（演習・試験セッション）
--    total_questions を追加（模試の正答率＝score/total_questions の分母）
-- ============================================================
CREATE TABLE public.exam_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('PRACTICE', 'MOCK_EXAM')),
    status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    score INTEGER,                               -- 最終正解数
    total_questions INTEGER,                     -- 出題数（正答率の分母。スタンプ判定に使用）
    time_limit_minutes INTEGER,                  -- 制限時間（模試）
    is_timeout BOOLEAN DEFAULT FALSE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- ============================================================
-- 5.5 Session Questions【新規】（セッションの出題問題と順序）
--    結果画面の再現・中断再開・同一模試の再挑戦に使用
-- ============================================================
CREATE TABLE public.session_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 1,
    UNIQUE (session_id, question_id)
);

-- ============================================================
-- 6. User Answers（解答履歴・全件）
-- ============================================================
CREATE TABLE public.user_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
    exam_session_id UUID REFERENCES public.exam_sessions(id) ON DELETE SET NULL,
    selected_choice_ids UUID[] NOT NULL,
    is_correct BOOLEAN NOT NULL,
    answered_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6.5 User Question Status【新規】（問題ごとの最新状態の集約）
--    未出題/ミス/ヒットの判定とフィルタを高速化
--    last_result: 最新解答の正誤（true=ヒット, false=ミス。行が無い=未出題）
-- ============================================================
CREATE TABLE public.user_question_status (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    last_result BOOLEAN NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    last_answered_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, question_id)
);

-- ============================================================
-- 7. User Bookmarks（メモ・お気に入り）
-- ============================================================
CREATE TABLE public.user_bookmarks (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
    is_favorite BOOLEAN DEFAULT FALSE,
    memo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, question_id)
);

-- 索引（フィルタ・集計の高速化）
CREATE INDEX idx_questions_category ON public.questions(category_id);
CREATE INDEX idx_uqs_user ON public.user_question_status(user_id);
CREATE INDEX idx_uqs_user_result ON public.user_question_status(user_id, last_result);
CREATE INDEX idx_user_answers_user ON public.user_answers(user_id);
CREATE INDEX idx_session_questions_session ON public.session_questions(session_id, display_order);

-- ============================================================
-- トリガ: 新規ユーザー登録時に profiles を自動生成
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RPC: submit_answer
--   完全一致で採点し、履歴・集約・コンボを1トランザクションで更新。
--   戻り値: 正誤（boolean）
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_answer(
    p_question_id UUID,
    p_selected_choice_ids UUID[],
    p_session_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_sel UUID[];
    v_cor UUID[];
    v_is_correct BOOLEAN;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 選択IDと正解IDをそれぞれソート済み配列に正規化（順序非依存の集合比較のため）
    v_sel := (
        SELECT COALESCE(array_agg(x ORDER BY x), '{}'::uuid[])
        FROM unnest(COALESCE(p_selected_choice_ids, '{}'::uuid[])) AS x
    );
    v_cor := (
        SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[])
        FROM public.choices
        WHERE question_id = p_question_id AND is_correct = TRUE
    );

    -- 完全一致判定（空選択は不正解になる）
    v_is_correct := (v_sel = v_cor);

    -- 履歴（全件）
    INSERT INTO public.user_answers (user_id, question_id, exam_session_id, selected_choice_ids, is_correct)
    VALUES (v_uid, p_question_id, p_session_id, p_selected_choice_ids, v_is_correct);

    -- 集約テーブル upsert（最新状態を上書き、正誤カウントを加算）
    INSERT INTO public.user_question_status
        (user_id, question_id, last_result, correct_count, wrong_count, last_answered_at)
    VALUES (
        v_uid, p_question_id, v_is_correct,
        CASE WHEN v_is_correct THEN 1 ELSE 0 END,
        CASE WHEN v_is_correct THEN 0 ELSE 1 END,
        NOW()
    )
    ON CONFLICT (user_id, question_id) DO UPDATE SET
        last_result      = EXCLUDED.last_result,
        correct_count    = public.user_question_status.correct_count + (CASE WHEN v_is_correct THEN 1 ELSE 0 END),
        wrong_count      = public.user_question_status.wrong_count + (CASE WHEN v_is_correct THEN 0 ELSE 1 END),
        last_answered_at = NOW();

    -- コンボ更新（正解で+1／不正解で0）＋延べカウント
    UPDATE public.profiles SET
        current_combo  = CASE WHEN v_is_correct THEN current_combo + 1 ELSE 0 END,
        total_answered = total_answered + 1,
        total_correct  = total_correct + (CASE WHEN v_is_correct THEN 1 ELSE 0 END),
        updated_at     = NOW()
    WHERE id = v_uid;

    RETURN v_is_correct;
END;
$$;

-- ============================================================
-- RPC: get_user_stats
--   ダッシュボード用。未出題/ミス/ヒット、コンボ、%、スタンプ数、レベルをJSONで返す。
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_total INTEGER;      -- 全問題数 N
    v_answered INTEGER;   -- 解答済みユニーク数
    v_hit INTEGER;        -- ヒット（last_result=true）
    v_miss INTEGER;       -- ミス（last_result=false）
    v_untried INTEGER;    -- 未出題
    v_combo INTEGER;      -- 現在コンボ
    v_hit_pct NUMERIC;
    v_combo_pct NUMERIC;
    v_hit_stamps INTEGER;
    v_combo_stamps INTEGER;
    v_mock80 INTEGER;
    v_mock90 INTEGER;
    v_mock80_stamps INTEGER;
    v_mock90_stamps INTEGER;
    v_level INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT COUNT(*) INTO v_total FROM public.questions;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE last_result = TRUE),
        COUNT(*) FILTER (WHERE last_result = FALSE)
    INTO v_answered, v_hit, v_miss
    FROM public.user_question_status
    WHERE user_id = v_uid;

    v_untried := v_total - v_answered;

    SELECT current_combo INTO v_combo FROM public.profiles WHERE id = v_uid;
    v_combo := COALESCE(v_combo, 0);

    -- % は全問題数 N を分母に固定
    v_hit_pct   := CASE WHEN v_total > 0 THEN (v_hit::numeric   / v_total) * 100 ELSE 0 END;
    v_combo_pct := CASE WHEN v_total > 0 THEN (v_combo::numeric / v_total) * 100 ELSE 0 END;

    -- 10%ごとに1スタンプ（上限10）
    v_hit_stamps   := LEAST(FLOOR(v_hit_pct   / 10)::int, 10);
    v_combo_stamps := LEAST(FLOOR(v_combo_pct / 10)::int, 10);

    -- 模試スタンプ: 完了済み模試で正答率80%/90%以上の回数（各上限10）
    SELECT
        COUNT(*) FILTER (WHERE total_questions > 0 AND (score::numeric / total_questions) >= 0.8),
        COUNT(*) FILTER (WHERE total_questions > 0 AND (score::numeric / total_questions) >= 0.9)
    INTO v_mock80, v_mock90
    FROM public.exam_sessions
    WHERE user_id = v_uid
      AND session_type = 'MOCK_EXAM'
      AND status = 'COMPLETED';

    v_mock80_stamps := LEAST(COALESCE(v_mock80, 0), 10);
    v_mock90_stamps := LEAST(COALESCE(v_mock90, 0), 10);

    v_level := v_hit_stamps + v_combo_stamps + v_mock80_stamps + v_mock90_stamps;

    RETURN json_build_object(
        'total_questions', v_total,
        'untried',         v_untried,
        'miss',            v_miss,
        'hit',             v_hit,
        'combo',           v_combo,
        'hit_pct',         ROUND(v_hit_pct, 1),
        'combo_pct',       ROUND(v_combo_pct, 1),
        'hit_stamps',      v_hit_stamps,
        'combo_stamps',    v_combo_stamps,
        'mock80_stamps',   v_mock80_stamps,
        'mock90_stamps',   v_mock90_stamps,
        'level',           v_level,
        'max_level',       40
    );
END;
$$;

-- ============================================================
-- RPC: get_category_counts
--   子カテゴリごとの保有問題数（分野選択リスト用）
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_counts()
RETURNS TABLE (category_id UUID, category_name TEXT, question_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.id, c.name::text, COUNT(q.id)
    FROM public.categories c
    LEFT JOIN public.questions q ON q.category_id = c.id
    WHERE c.parent_id IS NOT NULL   -- 子カテゴリ（分野）のみ
    GROUP BY c.id, c.name
    ORDER BY c.name;
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_images       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.choices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_answers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_status  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bookmarks        ENABLE ROW LEVEL SECURITY;

-- 問題系: 認証済みユーザーは閲覧のみ（投入はサービスロールで行う）
CREATE POLICY "read categories"       ON public.categories       FOR SELECT TO authenticated USING (true);
CREATE POLICY "read questions"        ON public.questions        FOR SELECT TO authenticated USING (true);
CREATE POLICY "read question_images"  ON public.question_images  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read choices"          ON public.choices          FOR SELECT TO authenticated USING (true);

-- profiles: 本人のみ（SELECT/UPDATE は USING、INSERT は WITH CHECK）
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- exam_sessions: 本人のみ
CREATE POLICY "sessions_select" ON public.exam_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert" ON public.exam_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_update" ON public.exam_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete" ON public.exam_sessions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- session_questions: 親セッションが本人のものかで判定
CREATE POLICY "session_questions_select" ON public.session_questions FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()));
CREATE POLICY "session_questions_insert" ON public.session_questions FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()));
CREATE POLICY "session_questions_delete" ON public.session_questions FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()));

-- user_answers: 本人のみ
CREATE POLICY "answers_select" ON public.user_answers FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "answers_insert" ON public.user_answers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- user_question_status: 本人のみ
CREATE POLICY "uqs_select" ON public.user_question_status FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "uqs_insert" ON public.user_question_status FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "uqs_update" ON public.user_question_status FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_bookmarks: 本人のみ
CREATE POLICY "bookmarks_select" ON public.user_bookmarks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bookmarks_insert" ON public.user_bookmarks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bookmarks_update" ON public.user_bookmarks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bookmarks_delete" ON public.user_bookmarks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 関数の実行権限（RPC はログインユーザーが呼べるように）
GRANT EXECUTE ON FUNCTION public.submit_answer(UUID, UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_counts() TO authenticated;

-- ============================================================
-- 初期データ: 親カテゴリ＋子カテゴリ（分野）
--   ※ 分野名・構成は実際の出題範囲に合わせて調整してください。
-- ============================================================
INSERT INTO public.categories (id, name, parent_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'ORACLE GOLD DBA 2019', NULL);

INSERT INTO public.categories (name, parent_id) VALUES
    ('リレーショナル・データベース', '00000000-0000-0000-0000-000000000001'),
    ('Select文',                     '00000000-0000-0000-0000-000000000001'),
    ('データの制限およびソート',       '00000000-0000-0000-0000-000000000001'),
    ('単一行関数',                    '00000000-0000-0000-0000-000000000001'),
    ('変換関数および条件式',           '00000000-0000-0000-0000-000000000001'),
    ('DML文',                         '00000000-0000-0000-0000-000000000001'),
    ('DDL文',                         '00000000-0000-0000-0000-000000000001');
