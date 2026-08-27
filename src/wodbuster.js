import { appendFileSync } from 'node:fs';
import { launch } from 'puppeteer';
import {
  decideReservation,
  getISODateFromUrl,
  getReservationKey,
  getWeekdayFromUrl,
  normalizeButtonState,
  parsePreference,
} from './domain.js';
import { waitUntil } from './time.js';

const SELECTORS = Object.freeze({
  email: '#body_body_CtlLogin_IoEmail',
  password: '#body_body_CtlLogin_IoPassword',
  submit: '#body_body_CtlLogin_CtlAceptar',
  forgetDevice: '#body_body_CtlUp label.button:nth-of-type(2)',
  title: '.mainTitle',
  nextDay: 'a.next',
});

async function settleNetwork(page, timeout = 5_000) {
  await page.waitForNetworkIdle({ timeout }).catch(() => {});
}

async function login(page, config) {
  const loginUrl = `${config.baseUrl}/account/login.aspx`;
  await page.goto(loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.navigationTimeoutMs,
  });

  try {
    await page.waitForSelector(SELECTORS.email, { timeout: 20_000 });
  } catch {
    const pageText = await page.evaluate(() => document.body?.innerText ?? '');
    if (/captcha|verifica que eres humano|verify you are human/i.test(pageText)) {
      throw new Error(
        'WodBuster mostró una verificación CAPTCHA. Este proyecto no la elude; inicia sesión manualmente.'
      );
    }
    throw new Error('No se encontró el formulario de acceso de WodBuster.');
  }

  await page.type(SELECTORS.email, config.email, { delay: 15 });
  await page.type(SELECTORS.password, config.password, { delay: 15 });

  await Promise.all([
    page
      .waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
      })
      .catch(() => null),
    page.click(SELECTORS.submit),
  ]);
  await settleNetwork(page);

  const forgetDeviceButton = await page.$(SELECTORS.forgetDevice);
  if (forgetDeviceButton) {
    await forgetDeviceButton.click();
    await settleNetwork(page);
  }

  if (await page.$(SELECTORS.email)) {
    throw new Error('WodBuster rechazó el acceso. Revisa el correo y la contraseña guardados en Secrets.');
  }
}

async function goToReservations(page, timeout) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const timestamp = Math.floor(today.getTime() / 1000);
  const origin = new URL(page.url()).origin;

  await page.goto(`${origin}/athlete/reservas.aspx?t=${timestamp}`, {
    waitUntil: 'domcontentloaded',
    timeout,
  });
  await settleNetwork(page);
}

async function findReservationButton(page, reservationKey, className) {
  const buttons = await page.$$(`div[data-magellan-destination="${reservationKey}"] button`);
  if (buttons.length === 0) return null;
  if (!className) return buttons[0];

  for (const button of buttons) {
    const sectionText = await button.evaluate(element => {
      const section = element.closest('[data-magellan-destination]');
      return section?.textContent ?? '';
    });
    if (sectionText.toLowerCase().includes(className.toLowerCase())) {
      return button;
    }
  }

  // No se elige la primera actividad como alternativa: podría reservar una clase incorrecta.
  return null;
}

async function readButtonState(button) {
  return normalizeButtonState(await button.evaluate(element => element.textContent));
}

async function verifyBooking(page, reservationKey, className) {
  const updatedButton = await findReservationButton(page, reservationKey, className);
  if (!updatedButton) return null;
  return readButtonState(updatedButton);
}

async function reservePreference(page, preference, config) {
  const { time, className } = parsePreference(preference);
  const weekday = getWeekdayFromUrl(page.url());
  const date = getISODateFromUrl(page.url());
  const reservationKey = getReservationKey(time);
  const button = await findReservationButton(page, reservationKey, className);

  if (!button) {
    return {
      date,
      weekday,
      time,
      status: 'slot-not-found',
      ok: false,
      message: className
        ? `No se encontró ${className} a las ${time}.`
        : `No se encontró una clase a las ${time}.`,
    };
  }

  const initialState = await readButtonState(button);
  const decision = decideReservation(initialState, config);

  if (!decision.click) {
    const messages = {
      'would-book': 'Prueba correcta: la clase se podría reservar.',
      'would-join-waitlist': 'Prueba correcta: se podría entrar en la lista de espera.',
      'waitlist-available': 'La clase está completa; no se entró en la lista de espera.',
      'already-booked': 'La clase ya estaba reservada.',
      'conflicting-booking': 'Ya existe otra reserva incompatible para ese día.',
      finished: 'La clase ya ha finalizado.',
      unavailable: `Estado de WodBuster no reconocido: ${initialState || 'vacío'}.`,
    };
    return {
      date,
      weekday,
      time,
      status: decision.action,
      ok: decision.ok,
      message: messages[decision.action],
    };
  }

  await button.click();
  await settleNetwork(page);
  await new Promise(resolve => setTimeout(resolve, 800));

  const finalState = await verifyBooking(page, reservationKey, className);
  const confirmed = finalState === 'Borrar';
  if (!confirmed) {
    return {
      date,
      weekday,
      time,
      status: 'unconfirmed',
      ok: false,
      message: `WodBuster no confirmó la operación (estado final: ${finalState || 'no disponible'}).`,
    };
  }

  return {
    date,
    weekday,
    time,
    status: decision.action === 'book' ? 'booked' : 'waitlisted',
    ok: true,
    message: decision.action === 'book' ? 'Reserva confirmada.' : 'Lista de espera confirmada.',
  };
}

async function goToNextDay(page) {
  const button = await page.$(SELECTORS.nextDay);
  if (!button) return false;

  const dateBefore = getISODateFromUrl(page.url());
  await button.click();
  await settleNetwork(page);
  return getISODateFromUrl(page.url()) !== dateBefore;
}

async function processReservations(page, config) {
  const results = [];
  const seenScheduledDays = new Set();

  for (let index = 0; index < config.daysAhead; index += 1) {
    const weekday = getWeekdayFromUrl(page.url());
    const preference = config.schedule[weekday];

    if (preference) {
      seenScheduledDays.add(weekday);
      try {
        results.push(await reservePreference(page, preference, config));
      } catch (error) {
        results.push({
          date: getISODateFromUrl(page.url()),
          weekday,
          time: parsePreference(preference).time,
          status: 'error',
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (index === config.daysAhead - 1) break;
    if (!(await goToNextDay(page))) break;
  }

  for (const [weekday, preference] of Object.entries(config.schedule)) {
    if (!seenScheduledDays.has(weekday)) {
      results.push({
        date: '—',
        weekday,
        time: parsePreference(preference).time,
        status: 'day-not-visible',
        ok: false,
        message: 'WodBuster no mostró este día dentro del horizonte disponible.',
      });
    }
  }

  return results;
}

function escapeTableCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function writeSummary(results, file = process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '# Resultado de reservas',
    '',
    '| Fecha | Día | Hora | Estado | Detalle |',
    '|---|---|---:|---|---|',
    ...results.map(result =>
      `| ${escapeTableCell(result.date)} | ${escapeTableCell(result.weekday)} | ${escapeTableCell(result.time)} | ${escapeTableCell(result.status)} | ${escapeTableCell(result.message)} |`
    ),
    '',
  ];

  const markdown = lines.join('\n');
  console.log(markdown);
  if (file) appendFileSync(file, markdown, 'utf8');
}

export async function runWodBuster(config) {
  const browser = await launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(config.navigationTimeoutMs);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    );

    console.log('Abriendo WodBuster e iniciando sesión…');
    await login(page, config);
    await waitUntil(config.targetEpochMs, { log: message => console.log(message) });
    console.log('Consultando las clases disponibles…');
    await goToReservations(page, config.navigationTimeoutMs);

    const results = await processReservations(page, config);
    writeSummary(results);
    return results;
  } finally {
    await browser.close();
  }
}
