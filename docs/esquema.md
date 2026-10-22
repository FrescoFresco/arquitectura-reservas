# Esquema de la base de datos

> Generado por `npm run esquema` desde `catalogo/`. No lo edites a mano.

Una caja por colección. Cada línea es un campo: tipo, nombre y nivel. En los nombres, `-` separa niveles del documento y `[]` marca una lista (`recorrido-campos[]-nombre` es `recorrido.campos.N.nombre`). Las líneas entre cajas salen de los campos `id_*`: `||` si el campo es blindado (siempre está) y `o|` si es estable (puede faltar).

```mermaid
erDiagram
  negocios {
    id _id PK "neg-…"
    texto nombre "blindado"
    url_sin_pii url "blindado"
    zona_horaria zona_horaria "blindado"
    telefono telefono "estable"
  }
  procesos {
    id _id PK "proc-…"
    id id_negocio FK "blindado"
    url_sin_pii url_inicio "blindado"
    enum alcance "blindado"
    id id_version_activa FK "estable"
  }
  versiones {
    id _id PK "ver-…"
    id id_proceso FK "blindado"
    enum estado "blindado"
    fecha creada "blindado"
    texto aprobacion-por "estable"
    fecha aprobacion-fecha "estable"
    texto recorrido-sistema-nombre "estable"
    texto_largo recorrido-sistema-evidencia "estable"
    booleano recorrido-llega_a_b "estable"
    texto recorrido-pasos[]-accion "blindado"
    texto recorrido-pasos[]-selector "estable"
    url_sin_pii recorrido-pasos[]-url "estable"
    texto recorrido-campos[]-nombre "blindado"
    texto recorrido-campos[]-selector "blindado"
    enum recorrido-campos[]-control "estable"
    booleano recorrido-campos[]-obligatorio "blindado"
    enum recorrido-campos[]-clase "blindado"
    texto recorrido-campos[]-evidencia "estable"
    texto recorrido-campos[]-valor_prueba "estable"
    enum recorrido-obstaculos[]-tipo "blindado"
    texto recorrido-obstaculos[]-descripcion "blindado"
    texto recorrido-obstaculos[]-evidencia "estable"
    texto recorrido-boton_confirmar-selector "estable"
    texto recorrido-boton_confirmar-texto "estable"
    texto_largo recorrido-mensaje_sin_hueco "estable"
    texto_largo script "estable"
    texto funcion-nombre "estable"
    json funcion-parametros "flexible"
  }
  ejecuciones {
    id _id PK "ejec-…"
    id id_version FK "blindado"
    enum modo "blindado"
    json parametros "flexible"
    fecha inicio "blindado"
    fecha fin "estable"
    url_sin_pii ultima_url "estable"
    fecha traza[]-hora "blindado"
    texto traza[]-mensaje "blindado"
    enum respuesta-estado "blindado"
    texto respuesta-referencia "estable"
    texto respuesta-alternativas[] "estable"
    enum respuesta-motivo "estable"
  }
  corridas {
    id _id PK "corr-…"
    texto plantilla "blindado"
    entero version_plantilla "blindado"
    texto version_catalogo "blindado"
    fecha fecha "blindado"
    id id_negocio FK "estable"
    id id_proceso FK "estable"
    id id_version FK "estable"
    texto_largo entrada "blindado"
    texto_largo respuesta "blindado"
    booleano guardada "blindado"
    json entendido "flexible"
    texto errores[] "estable"
    texto propuestas[]-ruta "blindado"
    texto_largo propuestas[]-valor "estable"
    enum propuestas[]-estado "blindado"
  }
  procesos }o--|| negocios : "id_negocio"
  procesos }o--o| versiones : "id_version_activa"
  versiones }o--|| procesos : "id_proceso"
  ejecuciones }o--|| versiones : "id_version"
  corridas }o--o| negocios : "id_negocio"
  corridas }o--o| procesos : "id_proceso"
  corridas }o--o| versiones : "id_version"
```
