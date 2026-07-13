import { supabase } from './supabase'

// Client-side event logging for actions that don't go through a server RPC
// (server functions log their own events). Fire-and-forget.
export async function recordEvent(campaignId, eventType, message, payload = {}, turnNumber = null) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('campaign_event').insert({
      campaign_id: campaignId, turn_number: turnNumber,
      event_type: eventType, actor: user?.id, message, payload,
    })
  } catch (e) {
    console.warn('event log failed', e)
  }
}
