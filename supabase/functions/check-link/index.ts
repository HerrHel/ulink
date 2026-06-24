import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { url, bookmark_id } = await req.json()

    if (!url || !url.startsWith('http')) {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const startTime = Date.now()
    let status = 'unknown'
    let http_status = 0
    let details: Record<string, unknown> = {}

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      clearTimeout(timeout)
      http_status = response.status
      const responseTime = Date.now() - startTime

      if (response.status >= 200 && response.status < 400) {
        status = 'alive'
      } else if (response.status >= 400) {
        status = 'dead'
      }

      details = {
        response_time: responseTime,
        final_url: response.url,
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime

      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        status = 'blocked'
      } else {
        status = 'dead'
      }

      details = {
        response_time: responseTime,
        error: error.message || 'unknown error'
      }
    }

    const { error: insertError } = await supabase
      .from('link_check_history')
      .insert({
        user_id: user.id,
        bookmark_id: bookmark_id || '',
        url,
        status,
        http_status,
        response_time: details.response_time,
        details
      })

    if (insertError) {
      console.error('Failed to insert check history:', insertError)
    }

    if (bookmark_id) {
      const attrs: Record<string, unknown> = {}
      if (status === 'dead') {
        attrs['dead-link'] = true
        attrs['gfw-blocked'] = false
      } else if (status === 'blocked') {
        attrs['dead-link'] = false
        attrs['gfw-blocked'] = true
      } else {
        attrs['dead-link'] = false
        attrs['gfw-blocked'] = false
      }

      await supabase
        .from('bookmarks')
        .update({ attributes: attrs })
        .eq('id', bookmark_id)
        .eq('user_id', user.id)
    }

    return new Response(
      JSON.stringify({ status, http_status, details }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
