// Seed mongosh — arquitectura_reservas
// Generado desde los ejemplos Extended JSON de la sección MongoDB de la UI.
// Una base de datos, 10 colecciones. Fechas: Extended JSON $date → ISODate.
// Uso:
//   mongosh "mongodb://localhost:27017" seed-arquitectura-reservas.js
//   mongosh "mongodb+srv://USER:PASS@CLUSTER/" seed-arquitectura-reservas.js
// Idempotente: replaceOne + upsert por _id.

const dbName = "arquitectura_reservas";
const target = db.getSiblingDB(dbName);
print("Usando base de datos: " + dbName);

const seed = {
  negocios: [
    {
      _id: "neg-el-muelle",
      url: "https://www.elmuelle.example",
      nombre: "Restaurante El Muelle",
      zona: "Atlantic/Canary",
      ambito_festivo: {
        pais: "España",
        comunidad_o_region: "Canarias",
        isla_o_provincia: "Tenerife",
        municipio: "Santa Cruz de Tenerife"
      },
      canales_contacto: [
        {
          tipo: "telefono",
          valor: "+34 922 000 222",
          tipo_linea: "fijo",
          uso_publicado: "contacto",
          verificado_como_contacto: true,
          fuente: "https://www.elmuelle.example/contacto",
          fecha_consulta: ISODate("2026-10-14T11:00:00.000Z"),
          evidencia: "Publicado en Contacto"
        }
      ],
      apertura: {
        version: "v1",
        timestamp: ISODate("2026-10-14T20:55:00.000Z"),
        observacion_apertura_md: "# Apertura — Restaurante El Muelle\n**version:** v1\n",
        pila_cron: [
          {
            tipo: "horario_ordinario",
            efecto: "abierto",
            cron: "0 13-15 * * 1-6",
            fuente: "https://www.elmuelle.example/horario",
            nota: "comida"
          },
          {
            tipo: "horario_ordinario",
            efecto: "abierto",
            cron: "0 20-22 * * 1-6",
            fuente: "https://www.elmuelle.example/horario",
            nota: "cena"
          },
          {
            tipo: "cierre_semanal",
            efecto: "cerrado",
            cron: "0 0 * * 0",
            fuente: "https://www.elmuelle.example/horario",
            nota: "domingo"
          }
        ],
        abierto_ahora: true,
        margen_hasta_cierre_min: 95,
        proxima_hora_valida: null
      },
      auditoria_op: {
        ficha: {
          estado: "completa",
          evidencias: [
            {
              origen: "https://www.elmuelle.example",
              fragmento: "El Muelle · Tenerife",
              explicacion_md: "# Explicación de la evidencia\n\nNombre del negocio en la web\n"
            }
          ],
          incertidumbres: [],
          fecha_evaluacion: ISODate("2026-10-14T09:00:00.000Z"),
          fecha_validacion: ISODate("2026-10-14T10:00:00.000Z"),
          explicacion_md: "# Explicación\n\nFicha completa con zona Atlantic/Canary.\n"
        },
        ambito: {
          estado: "completa",
          fecha_evaluacion: ISODate("2026-10-14T09:02:00.000Z"),
          fecha_validacion: ISODate("2026-10-14T10:05:00.000Z")
        },
        contactos: {
          estado: "encontrado",
          fecha_evaluacion: ISODate("2026-10-14T11:05:00.000Z"),
          fecha_validacion: ISODate("2026-10-14T12:00:00.000Z")
        }
      },
      actualizado_en: ISODate("2026-10-14T12:00:00.000Z")
    }
  ],
  procesos: [
    {
      _id: "proc-muelle-sala",
      id_negocio: "neg-el-muelle",
      url_inicio: "https://www.elmuelle.example/reservas/cena-sala",
      alcance: "cena-sala",
      id_software: "sw-covermanager",
      actualizado_en: ISODate("2026-10-13T00:00:00.000Z")
    },
    {
      _id: "proc-muelle-terraza",
      id_negocio: "neg-el-muelle",
      url_inicio: "https://www.elmuelle.example/reservas/terraza",
      alcance: "terraza",
      id_software: null,
      actualizado_en: ISODate("2026-10-13T00:00:00.000Z")
    }
  ],
  software: [
    {
      _id: "sw-covermanager",
      nombre: "CoverManager",
      primera_vez: ISODate("2026-10-12T00:00:00.000Z"),
      actualizado_en: ISODate("2026-10-13T00:00:00.000Z")
    }
  ],
  integraciones: [
    {
      _id: "int-cm-v1",
      id_software: "sw-covermanager",
      version: "v1",
      timestamp: ISODate("2026-10-12T15:00:00.000Z"),
      estado: "documentada",
      resumen: "API partner CoverManager; acceso por negocio pendiente",
      documentacion_md: "# CoverManager — documentación de integración v1\n\nAPI partner para disponibilidad, alta y cancelación.\n",
      auditoria_op: {
        software: "CoverManager",
        incertidumbres: [],
        fecha_evaluacion: ISODate("2026-10-12T00:00:00.000Z"),
        fecha_validacion: null,
        explicacion_md: "# Explicación\n\nCoverManager documenta una API de reservas.\n"
      }
    }
  ],
  observaciones: [
    {
      _id: "obs-sala-v1",
      id_proceso: "proc-muelle-sala",
      version: "v1",
      timestamp: ISODate("2026-10-12T13:00:00.000Z"),
      estado: "completa",
      resumen: "Formulario CoverManager hasta antes de confirmar",
      documento_md: "# Observación — proc-muelle-sala\n\nRelato hasta antes de confirmar.\n",
      evidencias: [
        {
          tipo: "captura",
          url: "https://www.elmuelle.example/reservas/cena-sala",
          nota: "widget cargado"
        }
      ],
      auditoria_op: {
        fecha_evaluacion: ISODate("2026-10-12T00:00:00.000Z"),
        fecha_validacion: ISODate("2026-10-13T00:00:00.000Z"),
        explicacion_md: "# Explicación\n\nObservación completa.\n"
      }
    }
  ],
  justificantes: [
    {
      _id: "jus-sala-v1",
      id_proceso: "proc-muelle-sala",
      version: "v1",
      timestamp: ISODate("2026-10-12T14:00:00.000Z"),
      estado: "justificado",
      resumen: "Campos y señales desde observación v1",
      documento_md: "# Justificante\n\nCampos derivados de la observación.\n",
      auditoria_op: {
        fecha_evaluacion: ISODate("2026-10-12T00:00:00.000Z"),
        fecha_validacion: ISODate("2026-10-13T00:00:00.000Z"),
        explicacion_md: "# Explicación\n\nJustificado.\n"
      }
    }
  ],
  funciones: [
    {
      _id: "fun-sala-v1",
      id_proceso: "proc-muelle-sala",
      version: "v1",
      timestamp: ISODate("2026-10-12T15:00:00.000Z"),
      estado: "generada",
      resumen: "reservar_el_muelle_cena_sala",
      funcion_json: {
        name: "reservar_el_muelle_cena_sala",
        parameters: [
          {
            nombre: "fecha",
            tipo: "fecha",
            obligatorio: true
          },
          {
            nombre: "hora",
            tipo: "hora",
            obligatorio: true
          },
          {
            nombre: "comensales",
            tipo: "entero",
            obligatorio: true
          },
          {
            nombre: "nombre",
            tipo: "texto",
            obligatorio: true
          },
          {
            nombre: "telefono",
            tipo: "telefono",
            obligatorio: true
          },
          {
            nombre: "email",
            tipo: "email",
            obligatorio: false
          },
          {
            nombre: "zona",
            tipo: "opcion",
            opciones: [
              "cena-sala"
            ],
            obligatorio: true
          }
        ],
        response: {
          estado: "confirmada",
          referencia: "string",
          alternativas: [],
          motivo: null
        }
      },
      documento_md: "# Explicación\n\nLa función de cena-sala sale del justificante.\n"
    }
  ],
  scripts: [
    {
      _id: "scr-sala-v1",
      id_proceso: "proc-muelle-sala",
      version: "v1",
      timestamp: ISODate("2026-10-12T15:30:00.000Z"),
      estado: "generada",
      resumen: "Playwright cena-sala",
      script_js: {
        contenido: "// Reserva de prueba El Muelle, cena-sala. Sin credenciales.\nasync function reservar(page, datos) {\n  // rellena y se detiene antes de confirmar\n}\n",
        version: "1.0.0",
        huella: "script-sala-v1",
        referencia_codigo: "ejemplos/proc-muelle-sala/reservar.js@1.0.0"
      },
      documento_md: "# Explicación\n\nEl script de cena-sala rellena el formulario y se detiene antes de confirmar.\n"
    }
  ],
  canales: [
    {
      _id: "can-sala-v1",
      id_proceso: "proc-muelle-sala",
      version: "v1",
      timestamp: ISODate("2026-10-14T12:40:00.000Z"),
      estado: "encontrado",
      resumen: "Enlace cancelación + teléfono Contactos",
      busqueda_realizada: {
        fuentes_consultadas: [
          "confirmación",
          "web"
        ],
        opciones_revisadas: [
          "enlace sistema",
          "teléfono"
        ],
        limitaciones: []
      },
      cancelacion_sistema: {
        disponible: "si",
        metodo: "enlace de confirmación",
        url_o_instrucciones: "https://www.elmuelle.example/cancelar",
        evidencias: [
          {
            fuente: "https://www.elmuelle.example/cancelar",
            fecha_consulta: ISODate("2026-10-14T12:40:00.000Z"),
            fragmento: "Cancelar reserva"
          }
        ]
      },
      canal_preferido_cancelacion: {
        origen: "contacto_negocio",
        tipo: "telefono",
        valor: "+34 922 000 222",
        metodo: "llamada",
        motivo: "Contacto verificado en Contactos; atienden cancelaciones"
      },
      politica_cancelacion: {
        resumen: "Sin coste hasta 2 horas antes",
        plazo: "2 horas",
        coste_o_penalizacion: "sin coste",
        garantia_tarjeta: null
      },
      documento_md: "# Explicación\n\nPrefiere el teléfono ya verificado en Contactos.\n",
      auditoria_op: {
        fecha_evaluacion: ISODate("2026-10-14T12:45:00.000Z"),
        fecha_validacion: ISODate("2026-10-14T16:10:00.000Z"),
        incertidumbres: []
      }
    }
  ],
  ejecuciones: [
    {
      _id: "ej-sala-auto-1",
      id_proceso: "proc-muelle-sala",
      via: "automatica",
      timestamp: ISODate("2026-10-13T11:00:00.000Z"),
      resultado: "apta",
      id_referencia: "RES-1042",
      detalle: {
        metodo_utilizado: "script",
        pruebas_realizadas: [
          {
            tipo: "disponibilidad",
            resultado: "hueco",
            detalle: "mesa para 2 el 2026-10-18 a las 21:00 en cena-sala"
          },
          {
            tipo: "confirmacion",
            resultado: "confirmada",
            detalle: "RES-1042"
          }
        ],
        reserva_prueba: {
          estado: "confirmada",
          referencia: "RES-1042",
          fecha: "2026-10-18",
          hora: "21:00",
          comensales: 2,
          zona: "cena-sala",
          titular: "Ana Rojas"
        },
        impedimento: null
      }
    },
    {
      _id: "ej-sala-vig-1",
      id_proceso: "proc-muelle-sala",
      via: "vigilancia",
      timestamp: ISODate("2026-10-14T07:00:00.000Z"),
      resultado: "referencia_completa",
      id_referencia: "RES-1042",
      detalle: {
        referencia: {
          codigo: "RES-1042",
          tipo: "reserva_confirmada",
          revisada: true
        },
        contrato_resultado_ejecucion: {
          respuesta_interpretable: true,
          estado_respuesta: "confirmada",
          referencia: "RES-1042",
          coincide_con_sistema: true,
          version: "1.0.0",
          huella: "fn-sala-v1"
        },
        vigilancia: {
          activa: true,
          ultima_lectura: ISODate("2026-10-13T08:00:00.000Z"),
          crea_reservas: false
        },
        alertas: [],
        fiabilidad: "fiable",
        accion_requerida: null
      }
    }
  ]
};

const collectionNames = Object.keys(seed);
let totalUpserted = 0;
let totalModified = 0;
let totalMatched = 0;

for (const name of collectionNames) {
  const docs = seed[name];
  // Crea la colección si no existe (insert implícito también la crea).
  const existing = target.getCollectionNames();
  if (!existing.includes(name)) {
    target.createCollection(name);
    print("Colección creada: " + name);
  }
  const col = target.getCollection(name);
  let nUp = 0, nMod = 0, nMatch = 0;
  for (const doc of docs) {
    const res = col.replaceOne({ _id: doc._id }, doc, { upsert: true });
    nMatch += res.matchedCount || 0;
    nMod += res.modifiedCount || 0;
    nUp += res.upsertedCount || 0;
  }
  totalMatched += nMatch;
  totalModified += nMod;
  totalUpserted += nUp;
  print("  " + name + ": " + docs.length + " doc(s) — upserted=" + nUp + " modified=" + nMod + " matched=" + nMatch);
}

print("---");
print("Listo. Base: " + dbName + " · colecciones: " + collectionNames.length);
print("Totales: upserted=" + totalUpserted + " modified=" + totalModified + " matched=" + totalMatched);
print("Colecciones: " + target.getCollectionNames().filter(n => collectionNames.includes(n)).join(", "));
