import 'server-only'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export async function requireAdminAuth() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('sb-access-token')?.value

  if (!accessToken) {
    redirect('/admin/login')
  }

  // Verify the token belongs to the admin user
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: { user }, error } = await supabase.auth.getUser(accessToken)

  if (error || !user || user.email !== process.env.ADMIN_EMAIL) {
    redirect('/admin/login')
  }
}
