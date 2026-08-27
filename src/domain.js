export function parsePreference(value) {
  const [time, className] = value.split('|', 2);
  return {
    time: time.trim(),
    className: className?.trim() || null,
  };
}

export function getReservationKey(time) {
  return `h${time.replace(':', '')}00`;
}

function getTimestampFromReservationUrl(url) {
  const value = new URL(url).searchParams.get('t');
  const timestamp = Number(value);
  if (!value || !Number.isFinite(timestamp)) {
    throw new Error(`La URL de reservas no contiene una fecha válida: ${url}`);
  }
  return timestamp;
}

export function getISODateFromUrl(url) {
  const timestamp = getTimestampFromReservationUrl(url);
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function getWeekdayFromUrl(url) {
  const timestamp = getTimestampFromReservationUrl(url);
  return new Date(timestamp * 1000)
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    .toLowerCase();
}

export function normalizeButtonState(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function decideReservation(state, { dryRun, joinWaitlist }) {
  switch (normalizeButtonState(state)) {
    case 'Entrenar':
      return dryRun
        ? { action: 'would-book', click: false, ok: true }
        : { action: 'book', click: true, ok: true };
    case 'Avisar':
      if (!joinWaitlist) {
        return { action: 'waitlist-available', click: false, ok: false };
      }
      return dryRun
        ? { action: 'would-join-waitlist', click: false, ok: true }
        : { action: 'join-waitlist', click: true, ok: true };
    case 'Borrar':
      return { action: 'already-booked', click: false, ok: true };
    case 'Cambiar':
      return { action: 'conflicting-booking', click: false, ok: false };
    case 'Finalizada':
      return { action: 'finished', click: false, ok: false };
    default:
      return { action: 'unavailable', click: false, ok: false };
  }
}

export function shouldFailRun(results, dryRun) {
  if (results.length === 0) return true;
  if (!dryRun) return results.some(result => !result.ok);

  const blockingStatuses = new Set(['error', 'unavailable', 'unconfirmed']);
  return results.some(result => blockingStatuses.has(result.status));
}
