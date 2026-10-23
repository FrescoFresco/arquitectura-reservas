/**
 * Redactor: intención (texto) → definición JSON (disparador | flujo | pipeline).
 * Llama a OpenAI si hay OPENAI_API_KEY; si no, mock heurístico + validación.
 * Cada uso se registra en D1 `skill_ejecuciones` como ejecución de `generar-definicion`.
 */

import {
  PIPELINE_STAGES_ALLOWED,
  validateDisparadorBody,
  validatePipelineStages,
  parsePipeline,
  type DisparadorTipo,
} from './disparadores';
import { parseNodos, parseAristas, type FlujoNodo, type FlujoArista } from './flujos';

export const REDACTOR_SKILL_ID = 'generar-definicion';

export type TipoDefinicion = 'disparador' | 'flujo' | 'pipeline';

export type RedactorValidacion = {
  ok: boolean;
  errores: string[];
  avisos: string[];
};

export type RedactorResult = {
  definicion: unknown;
  explicacion: string;
  validacion: RedactorValidacion;
  modo: 'openai' | 'mock';
  modelo?: string;
};

export type RedactorContexto = {
  anclas: string[];
  colecciones: string[];
  skills: string[];
  flujos: string[];
};

export const SYSTEM_PROMPT_REDACTOR = `Eres el Redactor del hub Campos ancla. Devuelves SOLO un JSON válido con esta forma exacta:
{"definicion": <objeto según tipo_definicion>, "explicacion": "<2-3 frases en español>"}

Reglas:
- Usar solo anclas, skills y colecciones del contexto proporcionado. No inventes ids.
- Pipelines: solo etapas $match, $lookup, $project, $group, $sort, $limit, $unwind, $addFields. Prohibido $out, $merge, $function.
- Si falta algo (p. ej. una skill), dilo en explicacion y deja la definicion lo más correcta posible sin inventar.
- tipo_definicion=disparador → definicion con campos: tipo (manual|horario|cambio_datos|webhook), cron?, coleccion?, operaciones?, pipeline?, anti_bucle?, agrupar_segundos?, negocio?
- tipo_definicion=flujo → definicion: { "nodos": [...], "aristas": [...] } con nodos inicio/skill/decision/espera/subflujo/fin.
- tipo_definicion=pipeline → definicion: array de etapas de agregación.
- No envuelvas la respuesta en markdown ni en bloques de código.`;

export function isTipoDefinicion(t: string): t is TipoDefinicion {
  return t === 'disparador' || t === 'flujo' || t === 'pipeline';
}

export function esquemaParaTipo(tipo: TipoDefinicion): Record<string, unknown> {
  if (tipo === 'disparador') {
    return {
      tipo: 'manual|horario|cambio_datos|webhook',
      cron: '5 campos si horario',
      coleccion: 'si horario|cambio_datos',
      operaciones: ['crear|actualizar|borrar'],
      pipeline: 'etapas allowlist',
      anti_bucle: true,
      agrupar_segundos: 0,
      negocio: '',
    };
  }
  if (tipo === 'flujo') {
    return {
      nodos: [{ id: 'string', tipo: 'inicio|skill|decision|espera|subflujo|fin', skill: '?', condicion: '?' }],
      aristas: [{ desde: 'string', hacia: 'string', cuando: 'boolean?' }],
    };
  }
  return {
    pipeline: PIPELINE_STAGES_ALLOWED.map((s) => ({ [s]: '…' })),
  };
}

/** Valida la definición generada sin persistir. */
export function validarDefinicion(
  tipo: TipoDefinicion,
  definicion: unknown,
  ctx?: Partial<RedactorContexto>
): RedactorValidacion {
  const errores: string[] = [];
  const avisos: string[] = [];
  const skills = new Set((ctx?.skills || []).map(String));
  const colecciones = new Set((ctx?.colecciones || []).map(String));
  const anclas = new Set((ctx?.anclas || []).map(String));

  if (tipo === 'disparador') {
    if (!definicion || typeof definicion !== 'object' || Array.isArray(definicion)) {
      return { ok: false, errores: ['definicion debe ser un objeto disparador.'], avisos };
    }
    const body = { ...(definicion as Record<string, unknown>) };
    if (!body.tipo) body.tipo = 'manual';
    const v = validateDisparadorBody(body);
    if (!v.ok) errores.push(v.error);
    else {
      if (v.avisos?.length) avisos.push(...v.avisos);
      const col = v.value.coleccion;
      if (col && colecciones.size && !colecciones.has(col)) {
        avisos.push(`colección «${col}» no está en el contexto.`);
      }
      if (v.value.pipeline?.length && anclas.size) {
        // avisos de anclas ya los añade validateDisparadorBody vía caller; aquí check ligero
      }
    }
  } else if (tipo === 'pipeline') {
    const pipeParsed = parsePipeline(definicion);
    if (!pipeParsed.ok) {
      errores.push(pipeParsed.error);
    } else {
      const stageErr = validatePipelineStages(pipeParsed.pipeline);
      if (stageErr) errores.push(stageErr);
    }
  } else if (tipo === 'flujo') {
    if (!definicion || typeof definicion !== 'object' || Array.isArray(definicion)) {
      return { ok: false, errores: ['definicion debe ser { nodos, aristas }.'], avisos };
    }
    const o = definicion as Record<string, unknown>;
    const nodos = parseNodos(o.nodos);
    const aristas = parseAristas(o.aristas);
    if (!nodos.length) errores.push('nodos vacío o inválido.');
    if (!aristas.length) errores.push('aristas vacío o inválido.');
    const ids = new Set(nodos.map((n) => n.id));
    if (!nodos.some((n) => n.tipo === 'inicio')) errores.push('falta nodo tipo inicio.');
    if (!nodos.some((n) => n.tipo === 'fin')) errores.push('falta nodo tipo fin.');
    for (const a of aristas) {
      if (!ids.has(a.desde) || !ids.has(a.hacia)) {
        errores.push(`arista ${a.desde}→${a.hacia} apunta a nodo inexistente.`);
      }
    }
    for (const n of nodos) {
      if (n.tipo === 'skill') {
        if (!n.skill) errores.push(`nodo «${n.id}»: falta skill.`);
        else if (skills.size && !skills.has(n.skill)) {
          avisos.push(`skill «${n.skill}» no está en el contexto.`);
        }
      }
    }
  }

  return { ok: errores.length === 0, errores, avisos };
}

/** Mock heurístico cuando no hay OPENAI_API_KEY. */
export function generarMock(
  intencion: string,
  tipo: TipoDefinicion,
  ctx: RedactorContexto,
  definicionActual?: unknown
): RedactorResult {
  const text = String(intencion || '').toLowerCase();
  let definicion: unknown;
  let explicacion: string;

  if (tipo === 'pipeline') {
    const colHint = ctx.colecciones[0] || 'reservas';
    definicion = [
      { $match: { _negocio_hint: colHint } },
      { $limit: 50 },
    ];
    explicacion =
      'Mock: pipeline de lectura con $match+$limit. Configura OPENAI_API_KEY en el Worker para generación real.';
  } else if (tipo === 'flujo') {
    const skillA = ctx.skills.includes('descubrir-negocio')
      ? 'descubrir-negocio'
      : ctx.skills[0] || 'descubrir-negocio';
    const skillB = ctx.skills.includes('mapear-recorrido')
      ? 'mapear-recorrido'
      : ctx.skills[1] || skillA;
    const nodos: FlujoNodo[] = [
      { id: 'inicio', tipo: 'inicio' },
      { id: 'paso-1', tipo: 'skill', skill: skillA },
      { id: 'paso-2', tipo: 'skill', skill: skillB },
      { id: 'fin', tipo: 'fin' },
    ];
    const aristas: FlujoArista[] = [
      { desde: 'inicio', hacia: 'paso-1' },
      { desde: 'paso-1', hacia: 'paso-2' },
      { desde: 'paso-2', hacia: 'fin' },
    ];
    definicion = { nodos, aristas };
    explicacion = `Mock: flujo de 3 pasos (${skillA} → ${skillB}). Sin OPENAI_API_KEY no se interpreta la intención libre; revisa y ajusta antes de Guardar.`;
  } else {
    // disparador
    let tipoDisp: DisparadorTipo = 'manual';
    if (/webhook|whatsapp|http|entrada/.test(text)) tipoDisp = 'webhook';
    else if (/cada\s*hora|horario|cron|minuto|diario|semanal|recuerda|sin confirmar|hace\s+\d/.test(text))
      tipoDisp = 'horario';
    else if (/cambio|cuando|actualiz|crear|borrar|pasa a/.test(text)) tipoDisp = 'cambio_datos';

    const coleccion =
      (text.match(/\b(reservas|negocios|procesos|versiones|clientes|ejecuciones|alertas)\b/) || [])[0] ||
      (ctx.colecciones.includes('reservas') ? 'reservas' : ctx.colecciones[0] || 'reservas');

    if (tipoDisp === 'horario') {
      const cron = /cada\s*hora|0 \* \* \* \*/.test(text) ? '0 * * * *' : '0 * * * *';
      const pipeline: Record<string, unknown>[] = [];
      if (/sin confirmar|pendiente/.test(text)) {
        pipeline.push({
          $match: {
            $or: [{ estado: 'sin_confirmar' }, { estado: 'pendiente' }, { confirmada: false }],
          },
        });
      }
      if (/2\s*h|2 horas|hace más de 2/.test(text)) {
        pipeline.push({
          $match: {
            $expr: {
              $lte: ['$actualizado', { $subtract: ['$$NOW', 7200000] }],
            },
          },
        });
      }
      if (pipeline.length) pipeline.push({ $limit: 100 });
      definicion = {
        tipo: 'horario',
        cron,
        coleccion,
        pipeline,
        anti_bucle: true,
        agrupar_segundos: 0,
        negocio: '',
      };
      explicacion = `Mock: disparador horario cada hora sobre «${coleccion}» con pipeline de lectura según la intención. Pon OPENAI_API_KEY (secret del Worker) para generación con modelo.`;
    } else if (tipoDisp === 'cambio_datos') {
      definicion = {
        tipo: 'cambio_datos',
        coleccion,
        operaciones: ['crear', 'actualizar'],
        pipeline: [],
        anti_bucle: true,
        agrupar_segundos: 0,
        negocio: '',
      };
      explicacion = `Mock: disparador cambio_datos en «${coleccion}». Ajusta operaciones/pipeline y prueba antes de Guardar.`;
    } else if (tipoDisp === 'webhook') {
      definicion = {
        tipo: 'webhook',
        pipeline: [],
        anti_bucle: true,
        agrupar_segundos: 0,
        negocio: '',
      };
      explicacion = 'Mock: disparador webhook (el token lo genera la API al Guardar).';
    } else {
      definicion = {
        tipo: 'manual',
        anti_bucle: true,
        agrupar_segundos: 0,
        negocio: '',
        pipeline: [],
      };
      explicacion = 'Mock: disparador manual (botón Lanzar). Describe horario/cambio/webhook en la intención para otro tipo.';
    }

    if (definicionActual && typeof definicionActual === 'object') {
      // conservar id si venía
      const prev = definicionActual as Record<string, unknown>;
      if (prev.id) (definicion as Record<string, unknown>).id = prev.id;
    }
  }

  const validacion = validarDefinicion(tipo, definicion, ctx);
  return { definicion, explicacion, validacion, modo: 'mock' };
}

function extractJsonObject(raw: string): unknown {
  const t = String(raw || '').trim();
  if (!t) throw new Error('respuesta vacía del modelo');
  try {
    return JSON.parse(t);
  } catch {
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return JSON.parse(fence[1]!.trim());
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('no se pudo parsear JSON del modelo');
  }
}

export async function llamarOpenAI(opts: {
  apiKey: string;
  model: string;
  intencion: string;
  tipo: TipoDefinicion;
  contexto: RedactorContexto;
  definicionActual?: unknown;
  esquema: Record<string, unknown>;
}): Promise<{ definicion: unknown; explicacion: string; modelo: string }> {
  const userPayload = {
    intencion: opts.intencion,
    tipo_definicion: opts.tipo,
    esquema: opts.esquema,
    contexto: opts.contexto,
    definicion_actual: opts.definicionActual ?? null,
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_REDACTOR },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = extractJsonObject(content) as Record<string, unknown>;
  return {
    definicion: parsed.definicion,
    explicacion: String(parsed.explicacion || '').trim() || 'Definición generada.',
    modelo: opts.model,
  };
}

export async function generarDefinicion(opts: {
  intencion: string;
  tipo: TipoDefinicion;
  contexto: RedactorContexto;
  definicionActual?: unknown;
  openaiKey?: string;
  openaiModel?: string;
}): Promise<RedactorResult> {
  const esquema = esquemaParaTipo(opts.tipo);
  const key = String(opts.openaiKey || '').trim();
  if (!key) {
    return generarMock(opts.intencion, opts.tipo, opts.contexto, opts.definicionActual);
  }
  try {
    const model = String(opts.openaiModel || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
    const out = await llamarOpenAI({
      apiKey: key,
      model,
      intencion: opts.intencion,
      tipo: opts.tipo,
      contexto: opts.contexto,
      definicionActual: opts.definicionActual,
      esquema,
    });
    const validacion = validarDefinicion(opts.tipo, out.definicion, opts.contexto);
    return {
      definicion: out.definicion,
      explicacion: out.explicacion,
      validacion,
      modo: 'openai',
      modelo: out.modelo,
    };
  } catch (err) {
    const mock = generarMock(opts.intencion, opts.tipo, opts.contexto, opts.definicionActual);
    mock.explicacion =
      `Modelo falló (${err instanceof Error ? err.message : 'error'}); se usó mock. ` + mock.explicacion;
    mock.validacion.avisos = [
      ...(mock.validacion.avisos || []),
      'fallback mock tras error OpenAI',
    ];
    return mock;
  }
}

export async function registrarEjecucionSkill(
  db: D1Database,
  entrada: Record<string, unknown>,
  salida: Record<string, unknown>,
  opts: { modo: string; ok: boolean; origen?: string }
): Promise<string> {
  const id = `ej-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const creado = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO skill_ejecuciones (id, skill_id, origen, modo, ok, entrada_json, salida_json, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      REDACTOR_SKILL_ID,
      opts.origen || 'api',
      opts.modo,
      opts.ok ? 1 : 0,
      JSON.stringify(entrada),
      JSON.stringify(salida),
      creado
    )
    .run();
  return id;
}

export const SKILL_GENERAR_DEFINICION_MD = `# Generar definición

## Versión

1

## Instrucción

Convierte una intención en lenguaje natural en una definición JSON (disparador, flujo o pipeline) usando solo el contexto real del hub.

## Entrada

| Campo | Descripción |
|---|---|
| intencion | Texto libre del usuario |
| tipo_definicion | \`disparador\` \\| \`flujo\` \\| \`pipeline\` |
| esquema | Esquema del tipo |
| contexto | Anclas, colecciones, skills y flujos reales |
| definicion_actual | Definición previa si se edita |

## Salida

| Campo | Descripción |
|---|---|
| definicion | JSON según el tipo |
| explicacion | 2-3 frases |

## Reglas

- Solo anclas/skills/colecciones del contexto.
- Solo etapas de pipeline permitidas.
- Si falta algo, dilo en la explicación; no inventes.
- La IA **nunca guarda sola**: validar → probar → confirma el usuario.
`;
