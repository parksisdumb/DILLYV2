import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = String(formData.get('password') ?? '').trim()
  const adminSecret = process.env.ADMIN_SECRET_KEY ?? ''

  if (!adminSecret || password !== adminSecret) {
    return NextResponse.redirect(new URL('/admin/login?error=1', request.url), 303)
  }

  // Sign in as the dedicated admin Supabase user
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL!,
    password: process.env.ADMIN_PASSWORD!,
  })

  if (error) {
    return NextResponse.redirect(new URL('/admin/login?error=1', request.url), 303)
  }

  // Get the session to extract tokens
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.redirect(new URL('/admin/login?error=1', request.url), 303)
  }

  // Set the Supabase session cookies manually
  const response = NextResponse.redirect(new URL('/admin', request.url), 303)
  response.cookies.set('sb-access-token', session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  })
  response.cookies.set('sb-refresh-token', session.refresh_token!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  })
  return response
}
