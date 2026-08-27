import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideReservation,
  getISODateFromUrl,
  getReservationKey,
  getWeekdayFromUrl,
  isBookedState,
  isReservationConfirmationPrompt,
  parsePreference,
  shouldFailRun,
} from '../src/domain.js';

test('convierte las 16:00 en la clave de WodBuster', () => {
  assert.equal(getReservationKey('16:00'), 'h160000');
});

test('separa hora y actividad', () => {
  assert.deepEqual(parsePreference('16:00|CrossFit'), {
    time: '16:00',
    className: 'CrossFit',
  });
});

test('extrae fecha y día de la URL de reservas', () => {
  const url = 'https://box.example/athlete/reservas.aspx?t=1787616000';
  assert.equal(getISODateFromUrl(url), '2026-08-25');
  assert.equal(getWeekdayFromUrl(url), 'tuesday');
});

test('no hace clic durante una prueba', () => {
  assert.deepEqual(decideReservation('Entrenar', { dryRun: true, joinWaitlist: false }), {
    action: 'would-book',
    click: false,
    ok: true,
  });
});

test('reconoce el botón Reservar de la interfaz actual', () => {
  assert.deepEqual(decideReservation('Reservar', { dryRun: false, joinWaitlist: false }), {
    action: 'book',
    click: true,
    ok: true,
  });
});

test('reconoce la confirmación de la interfaz actual', () => {
  assert.equal(isBookedState('Cancelar'), true);
  assert.equal(isBookedState('Reservado'), true);
  assert.equal(isBookedState('Reservar'), false);
});

test('reconoce la hoja de confirmación móvil de WodBuster', () => {
  assert.equal(
    isReservationConfirmationPrompt(
      'CONFIRMACIÓN REQUERIDA Estás a punto de inscribirte en una clases ¿Estás seguro?'
    ),
    true
  );
  assert.equal(isReservationConfirmationPrompt('Aceptar cookies'), false);
});

test('no entra en lista de espera salvo petición explícita', () => {
  assert.deepEqual(decideReservation('Avisar', { dryRun: false, joinWaitlist: false }), {
    action: 'waitlist-available',
    click: false,
    ok: false,
  });
});

test('trata una reserva existente como resultado correcto', () => {
  assert.deepEqual(decideReservation('Borrar', { dryRun: false, joinWaitlist: false }), {
    action: 'already-booked',
    click: false,
    ok: true,
  });
});

test('una prueba no falla si las clases todavía no están visibles', () => {
  const results = [
    { status: 'slot-not-found', ok: false },
    { status: 'day-not-visible', ok: false },
  ];

  assert.equal(shouldFailRun(results, true), false);
  assert.equal(shouldFailRun(results, false), true);
});

test('una prueba sigue fallando ante un error técnico', () => {
  assert.equal(shouldFailRun([{ status: 'error', ok: false }], true), true);
  assert.equal(shouldFailRun([{ status: 'unavailable', ok: false }], true), true);
  assert.equal(shouldFailRun([], true), true);
});
