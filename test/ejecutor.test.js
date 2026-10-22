import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaLocal, parametrosDePrueba, comprobarRespuesta, seguroHastaB, lanzar } from '../src/ejecutor.js';

test('fechaLocal cuenta días en la zona del negocio, nunca hoy', () => {
  // 23:30 del 31-12 en UTC ya es 31-12 en Canarias (UTC+0 en invierno) y 1-1 en Madrid.
  const ahora = new Date('2026-12-31T23:30:00Z');
  assert.equal(fechaLocal('Atlantic/Canary', 3, ahora), '2027-01-03');
  assert.equal(fechaLocal('Europe/Madrid', 3, ahora), '2027-01-04');
});

test('parametrosDePrueba usa ejemplos y const, y exige ejemplo en los obligatorios', () => {
  const esquema = {
    required: ['fecha', 'personas', 'acepta'],
    properties: { fecha: { format: 'date' }, personas: { examples: [2] }, acepta: { const: true }, mensaje: { examples: ['x'] } },
  };
  const p = parametrosDePrueba(esquema, 'Atlantic/Canary');
  assert.deepEqual(Object.keys(p), ['fecha', 'personas', 'acepta']);
  assert.equal(p.personas, 2);
  assert.equal(p.acepta, true);
  assert.notEqual(p.fecha, fechaLocal('Atlantic/Canary', 0));
  assert.throws(() => parametrosDePrueba({ required: ['nombre'], properties: { nombre: {} } }, 'UTC'), /no tiene ejemplo/);
});

test('comprobarRespuesta exige las 4 claves con valores del catálogo', () => {
  const ok = { estado: 'disponible', referencia: null, alternativas: [], motivo: null };
  assert.equal(comprobarRespuesta(ok), ok);
  assert.ok(comprobarRespuesta({ estado: 'error', referencia: null, alternativas: [], motivo: 'obstaculo' }));
  for (const mal of [
    { estado: 'disponible', alternativas: [], motivo: null },
    { ...ok, estado: 'quizas' },
    { ...ok, motivo: 'otro' },
    { ...ok, alternativas: [1] },
    { ...ok, extra: 1 },
  ]) assert.throws(() => comprobarRespuesta(mal), /mal formada/);
});

test('el seguro de hasta_B bloquea clic, Enter y requestSubmit sobre el formulario del botón de confirmar', async () => {
  const navegador = await lanzar({ headless: true });
  const pagina = `data:text/html,<form onsubmit="event.preventDefault(); window.enviados = (window.enviados || 0) + 1">
    <input name="n"><button class="confirmar">Confirmar</button></form><button id="otro" onclick="window.otro = 1">Otro</button>`;
  const probar = async (conSeguro) => {
    const page = await navegador.newPage();
    if (conSeguro) await page.addInitScript(seguroHastaB, '.confirmar');
    await page.goto(pagina);
    await page.click('.confirmar');
    await page.fill('[name=n]', 'x');
    await page.press('[name=n]', 'Enter');
    await page.evaluate(() => document.forms[0].requestSubmit());
    await page.click('#otro');
    return page.evaluate(() => ({ enviados: window.enviados ?? 0, otro: window.otro ?? 0 }));
  };
  try {
    assert.deepEqual(await probar(false), { enviados: 3, otro: 1 }, 'sin seguro, la página de prueba sí envía');
    assert.deepEqual(await probar(true), { enviados: 0, otro: 1 }, 'con seguro no se envía nada y el resto funciona');
  } finally {
    await navegador.close();
  }
});
