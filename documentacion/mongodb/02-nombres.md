# Reglas de nombres

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Nombres de archivadores y cajones

Fuente: https://www.mongodb.com/docs/manual/reference/limits/

Nombres de archivador: en Linux/macOS no pueden contener `/\. "$`; en Windows tampoco `*<>:|?`; nunca el carácter nulo; no pueden estar vacíos y deben ocupar menos de 64 bytes. Nombres de cajón: deberían empezar por letra o `_`; no pueden contener `$` ni el carácter nulo, ni estar vacíos, ni empezar por `system.` ni contener `.system.` (reservados). El nombre completo `archivador.cajón` no puede pasar de 255 bytes (235 si el cajón está repartido en shards). Fuente: https://www.mongodb.com/docs/manual/reference/limits/

Ejemplo Pelo Sur: `pelo_sur.citas` es válido; `pelo_sur.system.citas` no.

### Reglas de nombres de etiquetas (campos)

Fuente: https://www.mongodb.com/docs/manual/core/document/#field-names y https://www.mongodb.com/docs/manual/core/dot-dollar-considerations/

- `_id` está reservado para la clave primaria.
- Los nombres son texto. No pueden contener el carácter nulo.
- El servidor *permite* guardar etiquetas con `$` o `.` (soporte mejorado desde 5.0), pero MongoDB **las desaconseja**: esas etiquetas no se pueden indexar, no se pueden consultar directamente (hacen falta `$getField`, `$setField`, `$literal`) y se confunden con la notación de punto (`direccion.ciudad`) y con los operadores (`$set`, `$gt`). Una etiqueta llamada `precio.total` se confunde con "la etiqueta `total` dentro de `precio`". Regla práctica: **nunca uses `.` ni `$` en nombres**.
- No hay límite propio de longitud del nombre, pero cuenta para el tamaño de la ficha (16 MB) y nombres largos repetidos en millones de fichas ocupan espacio. Usa nombres cortos y claros.
- Las etiquetas distinguen mayúsculas: `Nombre` ≠ `nombre`.
- Cada etiqueta debe ser única dentro de la ficha: con etiquetas duplicadas las operaciones pueden comportarse de forma inesperada.
