## Arquitectura de relaciones

Cómo se enlazan los catálogos entre sí. Los agentes no usan esta pantalla para trabajar: entran por API con una clave de invite.

```
┌─────────────┐         N:M          ┌─────────────┐
│  Proyecto   │◄───────────────────►│    Skill    │
└─────────────┘                      └──────┬──────┘
                                            │ 1:N
                                            ▼
                                     ┌─────────────┐
                                     │ Campo ancla │
                                     └──────┬──────┘
                                            │ 0..1  (enlace opcional)
                                            ▼
                                     ┌─────────────┐
                                     │ Campo Mongo │
                                     └─────────────┘

┌─────────────┐
│   Agente    │   (acceso / latido; trabaja vía API)
└─────────────┘

┌─────────────┐
│ Fundamento  │   (pieza base; vive en Documentación)
└─────────────┘
```

- **Proyecto ↔ Skill (N:M)** — un proyecto contiene una o más skills; una skill puede estar en uno o más proyectos.
- **Skill → Campo ancla (1:N)** — una skill declara uno o más campos ancla.
- **Ancla → Campo Mongo (0..1)** — un campo ancla puede enlazar a un campo Mongo (opcional). Con `proyeccionMongo: array` agrupa `version.recorrido.campos.N.*` en un array BSON (lista canónica del recorrido).
- **Sin anclas huérfanas** — todo hecho de un negocio (p. ej. Pelo Sur) entra como skill del proyecto; no persistir anclas sueltas fuera del catálogo.
- **Agente** — invite + registro + latido; trabaja vía API, no con la UI.
- **Fundamento** — bloque conceptual en Documentación con el que se describe el sistema.
