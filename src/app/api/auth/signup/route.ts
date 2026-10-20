// src/app/api/auth/signup/route.ts
// Supabase 대시보드에서 이메일 인증(Confirm email) 설정을 찾지 못해 끄지 않았더라도,
// 회원가입 즉시 이메일 인증 완료(email_confirm: true) 상태로 계정을 만들어 바로 로그인되게 해주는 API입니다.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email || !password || password.length < 6) {
      return NextResponse.json(
        { error: '이메일과 6자리 이상의 비밀번호를 입력해 주세요.' },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 이메일 인증 없이 즉시 활성화!
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '회원가입 처리 중 오류가 발생했습니다.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
