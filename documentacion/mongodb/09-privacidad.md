# Datos personales y cifrado

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Datos personales (PII) y cifrado

Fuente: https://www.mongodb.com/docs/manual/core/csfle/ y https://www.mongodb.com/docs/manual/core/queryable-encryption/

- **CSFLE (cifrado a nivel de campo en el cliente)**: el programa cifra etiquetas concretas (teléfono, DNI) *antes* de enviarlas; el servidor solo ve bytes (`binData` subtipo 6). Determinista permite buscar por igualdad; aleatorio no permite buscar.
- **Queryable Encryption**: igual de cifrado, pero permite consultar los datos cifrados. Según la documentación actual admite consultas de igualdad, rango, prefijo, sufijo y subcadena (las tres últimas dependen de la versión del servidor).
- Las claves se guardan en un cajón de claves y un gestor externo (KMS: AWS, Azure, GCP, KMIP).
- Además: cifrado en reposo y TLS en tránsito (https://www.mongodb.com/docs/manual/core/security-encryption-at-rest/). Regla práctica: guarda solo la PII imprescindible.
