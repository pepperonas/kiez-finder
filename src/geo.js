// ─────────────────────────────────────────────────────────────────────────
// Geolocation + reverse geocoding.
// ─────────────────────────────────────────────────────────────────────────

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject({ kind: 'unsupported', message: 'Dein Browser kennt keine Standortbestimmung.' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (err) => reject(mapGeoError(err)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    )
  })
}

function mapGeoError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return {
        kind: 'denied',
        message: 'Standortfreigabe abgelehnt. Erlaube den Zugriff, um deinen Kiez zu finden.',
      }
    case err.POSITION_UNAVAILABLE:
      return { kind: 'unavailable', message: 'Dein Standort ist gerade nicht abrufbar.' }
    case err.TIMEOUT:
      return { kind: 'timeout', message: 'Die Standortbestimmung hat zu lange gedauert.' }
    default:
      return { kind: 'unknown', message: 'Standort konnte nicht ermittelt werden.' }
  }
}

/**
 * Reverse geocode to a street address via Nominatim (OSM). Best-effort: the
 * Kiez classification comes from our own polygons, this only enriches the
 * address line. Cached for a day so we respect the 1 req/s usage policy.
 */
export async function reverseGeocode(lat, lon) {
  const key = `kf-rev-${lat.toFixed(4)},${lon.toFixed(4)}`
  try {
    const cached = sessionStorage.getItem(key)
    if (cached) return JSON.parse(cached)
  } catch (e) {}

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
    `&zoom=18&addressdetails=1&accept-language=de`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(t)
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address || {}
    const street = [a.road, a.house_number].filter(Boolean).join(' ')
    const line = [street, [a.postcode, a.suburb || a.city_district || a.borough].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ')
    const out = { line: line || data.display_name || null, raw: a }
    try {
      sessionStorage.setItem(key, JSON.stringify(out))
    } catch (e) {}
    return out
  } catch (e) {
    clearTimeout(t)
    return null
  }
}
