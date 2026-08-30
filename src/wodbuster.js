import { appendFileSync } from 'node:fs';
import { launch } from 'puppeteer';
import {
  decideReservation,
  getISODateFromUrl,
  getReservationKey,
  getReservationUrlForWeekday,
  getWeekdayFromUrl,
  isBookedState,
  isReservationConfirmationPrompt,
  matchesExactClassCard,
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
});

async function settleNetwork(page, timeout = 5_000) {
  await page.waitForNetworkIdle({ timeout }).catch(() => {});
}

async function login(page, config) {
  const loginUrl = new URL('/account/login.aspx', config.baseUrl);
  loginUrl.searchParams.set('cb', config.boxSlug);
  await page.goto(loginUrl.href, {
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

async function goToReservations(page, config, targetWeekday) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const timestamp = Math.floor(today.getTime() / 1000);
  const reservationsUrl = new URL('/athlete/reservas.aspx', config.reservationsBaseUrl);
  reservationsUrl.searchParams.set('t', String(timestamp));
  const targetUrl = getReservationUrlForWeekday(
    reservationsUrl.href,
    targetWeekday,
    config.daysAhead
  );
  if (!targetUrl) {
    throw new Error(`No se pudo calcular la fecha de ${targetWeekday}.`);
  }

  await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.navigationTimeoutMs,
  });
  await settleNetwork(page);

  const finalUrl = new URL(page.url());
  if (
    finalUrl.hostname !== new URL(config.reservationsBaseUrl).hostname ||
    !/\/athlete\/reservas\.aspx$/i.test(finalUrl.pathname) ||
    !finalUrl.searchParams.get('t') ||
    getWeekdayFromUrl(finalUrl.href) !== targetWeekday
  ) {
    throw new Error(
      `WodBuster no abrió las reservas de CrossFit Morado (ruta final: ${finalUrl.pathname}).`
    );
  }
}

async function buttonMatchesClassAndTime(button, className, time) {
  const contexts = await button.evaluate(element => {
      const actionStates = new Set([
        'Reservar',
        'Entrenar',
        'Avisar',
        'Borrar',
        'Cancelar',
        'Cancelar reserva',
        'Anular',
        'Reservado',
        'Cambiar',
        'Finalizada',
      ]);
      const matches = [];
      let current = element;
      for (let depth = 0; current && current !== document.body && depth < 8; depth += 1) {
        const text = (current.innerText ?? current.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 4_000) break;
        const actionButtonCount = [...current.querySelectorAll('button, [role="button"]')]
          .map(candidate => (candidate.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(candidateText => actionStates.has(candidateText)).length;
        matches.push({ text, actionButtonCount });
        current = current.parentElement;
      }
      return matches;
    });
  return contexts.some(context => matchesExactClassCard(context, className, time));
}

async function findReservationButton(page, reservationKey, className, time) {
  const buttons = await page.$$(`div[data-magellan-destination="${reservationKey}"] button`);
  if (!className && buttons.length > 0) return buttons[0];

  if (!className) return null;

  const currentButtons = await page.$$('button, [role="button"]');
  const actionStates = new Set([
    'Reservar',
    'Entrenar',
    'Avisar',
    'Borrar',
    'Cancelar',
    'Cancelar reserva',
    'Anular',
    'Reservado',
    'Cambiar',
    'Finalizada',
  ]);

  for (const button of currentButtons) {
    const visible = await button.evaluate(element => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (!visible || !actionStates.has(await readButtonState(button))) continue;
    if (await buttonMatchesClassAndTime(button, className, time)) return button;
  }

  // No se elige la primera actividad como alternativa: podría reservar una clase incorrecta.
  return null;
}

async function readButtonState(button) {
  return normalizeButtonState(
    await button.evaluate(element => element.textContent || element.value || '')
  );
}

async function verifyBooking(page, reservationKey, className, time) {
  const updatedButton = await findReservationButton(page, reservationKey, className, time);
  if (!updatedButton) return null;
  return readButtonState(updatedButton);
}

async function confirmReservationDialog(page) {
  const containers = await page.$$(
    'dialog[open], [role="dialog"], .modal.show, .modal.is-open, .reveal, .swal2-popup'
  );
  const confirmationTexts = new Set(['Reservar', 'Confirmar', 'Aceptar', 'Sí', 'Si']);

  for (const container of containers) {
    const visible = await container.evaluate(element => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (!visible) continue;

    const buttons = await container.$$('button, [role="button"]');
    for (const candidate of buttons) {
      const text = await readButtonState(candidate);
      if (!confirmationTexts.has(text)) continue;
      console.log(`Confirmando la reserva en WodBuster (${text})…`);
      await candidate.click();
      await settleNetwork(page);
      return true;
    }
  }

  // La interfaz móvil actual usa una hoja propia sin los selectores de modal habituales.
  // Solo se acepta un botón "Aceptar" si un antecesor contiene el texto inequívoco
  // de confirmación de inscripción; así se evita pulsar otros botones de la página.
  const candidates = await page.$$(
    'button, [role="button"], input[type="button"], input[type="submit"]'
  );
  for (const candidate of candidates) {
    const visible = await candidate.evaluate(element => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (!visible || (await readButtonState(candidate)) !== 'Aceptar') continue;

    const ancestorTexts = await candidate.evaluate(element => {
      const texts = [];
      let current = element.parentElement;
      for (let depth = 0; current && current !== document.body && depth < 8; depth += 1) {
        texts.push(current.innerText ?? current.textContent ?? '');
        current = current.parentElement;
      }
      return texts;
    });
    if (!ancestorTexts.some(isReservationConfirmationPrompt)) continue;

    console.log('Confirmando la reserva en WodBuster (Aceptar)…');
    await candidate.click();
    await settleNetwork(page);
    return true;
  }

  return false;
}

async function reservePreference(page, preference, config) {
  const { time, className } = parsePreference(preference);
  const weekday = getWeekdayFromUrl(page.url());
  const date = getISODateFromUrl(page.url());
  const reservationKey = getReservationKey(time);
  const button = await findReservationButton(page, reservationKey, className, time);

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

  page.once('dialog', async dialog => {
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.dismiss();
  });
  await button.click();
  await new Promise(resolve => setTimeout(resolve, 500));
  await confirmReservationDialog(page);
  await settleNetwork(page);
  await new Promise(resolve => setTimeout(resolve, 1_500));

  const finalState = await verifyBooking(page, reservationKey, className, time);
  const confirmed = isBookedState(finalState);
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

  console.log('Recargando WodBuster para comprobar que la reserva quedó guardada…');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  await settleNetwork(page);
  const persistedState = await verifyBooking(page, reservationKey, className, time);
  if (!isBookedState(persistedState)) {
    return {
      date,
      weekday,
      time,
      status: 'unconfirmed',
      ok: false,
      message: `La reserva apareció en pantalla, pero no persistió al recargar (estado: ${persistedState || 'no disponible'}).`,
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

async function processReservations(page, config) {
  const results = [];
  for (const [weekday, preference] of Object.entries(config.schedule)) {
    try {
      await goToReservations(page, config, weekday);
      results.push(await reservePreference(page, preference, config));
    } catch (error) {
      results.push({
        date: /\/athlete\/reservas\.aspx/i.test(page.url()) ? getISODateFromUrl(page.url()) : '—',
        weekday,
        time: parsePreference(preference).time,
        status: 'error',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
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

    const results = await processReservations(page, config);
    writeSummary(results);
    return results;
  } finally {
    await browser.close();
  }
}
