const DEFAULT_SCHEDULE = Object.freeze({
  tuesday: '16:00',
  thursday: '16:00',
});

const DEFAULT_BOX = 'morado';
const BOX_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const WEEKDAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?:\|[^|]+)?$/;

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Valor booleano no válido: ${value}`);
}

export function parseBoxSlug(value = DEFAULT_BOX) {
  const slug = String(value || DEFAULT_BOX).trim().toLowerCase();
  if (!BOX_PATTERN.test(slug)) {
    throw new Error(`Centro de WodBuster no válido: ${value}`);
  }
  return slug;
}

export function parseSchedule(rawValue) {
  let parsed;
  try {
    parsed = rawValue ? JSON.parse(rawValue) : DEFAULT_SCHEDULE;
  } catch {
    throw new Error('BOOKING_SCHEDULE debe ser un objeto JSON válido.');
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('BOOKING_SCHEDULE debe ser un objeto JSON.');
  }

  const schedule = {};
  for (const [rawDay, rawPreference] of Object.entries(parsed)) {
    const day = rawDay.trim().toLowerCase();
    const preference = String(rawPreference).trim();

    if (!WEEKDAYS.has(day)) {
      throw new Error(`Día no válido en BOOKING_SCHEDULE: ${rawDay}`);
    }
    if (!TIME_PATTERN.test(preference)) {
      throw new Error(
        `Horario no válido para ${day}: ${preference}. Usa HH:MM o HH:MM|Clase.`
      );
    }
    schedule[day] = preference;
  }

  if (Object.keys(schedule).length === 0) {
    throw new Error('BOOKING_SCHEDULE debe contener al menos un día.');
  }

  return schedule;
}

export function loadConfig(env = process.env) {
  const email = env.WODBUSTER_EMAIL?.trim() ?? '';
  const password = env.WODBUSTER_PASSWORD ?? '';

  if (!email || !password) {
    throw new Error(
      'Faltan WODBUSTER_EMAIL o WODBUSTER_PASSWORD. Añádelos como GitHub Actions Secrets.'
    );
  }

  const daysAhead = Number(env.BOOKING_DAYS_AHEAD ?? 7);
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 14) {
    throw new Error('BOOKING_DAYS_AHEAD debe ser un entero entre 1 y 14.');
  }

  const rawTarget = env.BOOKING_TARGET_EPOCH_MS?.trim();
  const targetEpochMs = rawTarget ? Number(rawTarget) : null;
  if (targetEpochMs !== null && (!Number.isFinite(targetEpochMs) || targetEpochMs <= 0)) {
    throw new Error('BOOKING_TARGET_EPOCH_MS no es una fecha válida.');
  }

  const boxSlug = parseBoxSlug(env.WODBUSTER_BOX);

  return {
    baseUrl: 'https://wodbuster.com',
    boxSlug,
    reservationsBaseUrl: `https://${boxSlug}.wodbuster.com`,
    email,
    password,
    schedule: parseSchedule(env.BOOKING_SCHEDULE),
    daysAhead,
    dryRun: parseBoolean(env.DRY_RUN, false),
    joinWaitlist: parseBoolean(env.JOIN_WAITLIST, false),
    targetEpochMs,
    navigationTimeoutMs: 60_000,
  };
}

export { DEFAULT_BOX, DEFAULT_SCHEDULE };
