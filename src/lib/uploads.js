import { supabase } from './supabase'

// Upload a file to the map-assets bucket, return its public URL.
// Assets are namespaced per campaign so cleanup is possible later.
export async function uploadAsset(campaignId, file, prefix = 'asset') {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${campaignId}/${prefix}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('map-assets')
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  return supabase.storage.from('map-assets').getPublicUrl(path).data.publicUrl
}
