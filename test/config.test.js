import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, parseBoolean, parseSchedule } from '../src/config.js';

test('usa martes y jueves a las 16:00 por defecto', () => {
  assert.deepEqual(parseSchedule(), {
    tuesday: '16:00',
    thursday: '16:00',
  });
});

test('admite un nombre de clase opcional', () => {
  assert.deepEqual(parseSchedule('{"tuesday":"16:00|CrossFit"}'), {
    tuesday: '16:00|CrossFit',
  });
});

test('rechaza días y horarios inválidos', () => {
  assert.throws(() => parseSchedule('{"martes":"16:00"}'), /Día no válido/);
  assert.throws(() => parseSchedule('{"tuesday":"4pm"}'), /Horario no válido/);
});

test('interpreta booleanos explícitos', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('0'), false);
  assert.throws(() => parseBoolean('quizá'), /booleano no válido/);
});

test('carga una configuración completa sin exponer secretos', () => {
  const config = loadConfig({
    WODBUSTER_EMAIL: 'persona@example.com',
    WODBUSTER_PASSWORD: 'secreto',
    BOOKING_DAYS_AHEAD: '7',
    DRY_RUN: 'true',
  });

  assert.equal(config.email, 'persona@example.com');
  assert.equal(config.password, 'secreto');
  assert.equal(config.daysAhead, 7);
  assert.equal(config.dryRun, true);
});

test('exige las credenciales', () => {
  assert.throws(() => loadConfig({}), /Faltan WODBUSTER_EMAIL/);
});
