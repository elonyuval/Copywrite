import { fileUrl } from '../lib/api'

export function BrandLogo({ name, fileId, size = 40 }: { name: string; fileId?: string | null; size?: number }) {
  if (fileId) return <img className="brand-logo" src={fileUrl(fileId)} alt="" style={{ width: size, height: size }} />
  return (
    <span className="brand-logo" style={{ width: size, height: size }} aria-hidden>
      {name.trim().slice(0, 1)}
    </span>
  )
}
