const MAX_WAIT_MS = 60 * 60 * 1000;

export async function waitUntil(
  targetEpochMs,
  {
    now = () => Date.now(),
    sleep = milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds)),
    log = () => {},
  } = {}
) {
  if (!targetEpochMs) return 0;

  const delay = Math.max(0, targetEpochMs - now());
  if (delay === 0) {
    log('La apertura ya ha llegado; se intentará reservar inmediatamente.');
    return 0;
  }
  if (delay > MAX_WAIT_MS) {
    throw new Error(
      `La espera calculada (${Math.ceil(delay / 60_000)} min) supera el máximo de 60 min.`
    );
  }

  log(`Sesión preparada. Esperando ${Math.ceil(delay / 1000)} segundos hasta la apertura.`);
  await sleep(delay);
  return delay;
}
