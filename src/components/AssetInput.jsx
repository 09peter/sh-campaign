import { useRef, useState } from 'react'
import { uploadAsset } from '../lib/uploads'

// URL field + upload button + thumbnail preview + clear.
// Accepts a pasted URL (self-hosted assets welcome) or a direct upload
// to Supabase Storage. Emits the resulting URL string (or null).
export default function AssetInput({ label, value, onChange, campaignId, prefix }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setErr(null)
    try {
      onChange(await uploadAsset(campaignId, file, prefix))
    } catch (ex) {
      setErr(ex.message ?? 'Upload failed')
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      {label && <span className="lbl">{label}</span>}
      <div className="flex items-center gap-2">
        {value
          ? <img src={value} alt="" className="w-8 h-8 object-cover rounded-sm border border-line shrink-0" />
          : <div className="w-8 h-8 rounded-sm border border-dashed border-line shrink-0" />}
        <input className="field font-mono text-[11px] min-w-0" placeholder="https://… or upload"
          value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
        <button type="button" className="btn-ghost text-[10px] whitespace-nowrap" disabled={busy}
          onClick={() => fileRef.current?.click()}>
          {busy ? '…' : 'Upload'}
        </button>
        {value && (
          <button type="button" className="text-ash hover:text-emberlight font-mono text-[10px]"
            onClick={() => onChange(null)}>clear</button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      </div>
      {err && <p className="text-emberlight font-mono text-[10px] mt-1">{err}</p>}
    </div>
  )
}
