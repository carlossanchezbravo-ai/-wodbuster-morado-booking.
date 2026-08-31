# Reserva WodBuster — CrossFit Morado

Automatización personal para intentar reservar en paralelo con dos cuentas de WodBuster estas clases:

| Día | Actividad | Hora | Apertura | Preparación automática |
|---|---|---:|---:|---:|
| Martes | CROSSFIT | 16:00 | Domingo 15:00 | Domingo 14:35 |
| Jueves | CROSSFIT | 16:00 | Domingo 22:30 | Domingo 22:05 |
| Viernes | CROSSFIT | 16:00 | Lunes 22:30 | Lunes 22:05 |

El martes, el jueves y el viernes se reservan en ejecuciones separadas según su día y hora de apertura. Cada ejecución inicia sesión con 25 minutos de margen y espera hasta la hora exacta antes de consultar y reservar. También incluye un modo de prueba manual que no pulsa ningún botón de reserva.

El centro está fijado explícitamente al subdominio de CrossFit Morado: `morado.wodbuster.com`.

> Este proyecto no está afiliado a WodBuster ni a CrossFit Morado. Confirma que la automatización está permitida por las normas del centro. Si aparece un CAPTCHA, el proceso se detiene: no intenta eludirlo.

## Configuración inicial

Las credenciales **nunca deben escribirse en un archivo, una incidencia o un mensaje**. Este repositorio es público; guárdalas únicamente como secretos cifrados de GitHub Actions.

1. Abre la página principal de este repositorio en GitHub.
2. Entra en **Settings → Secrets and variables → Actions**.
3. En **Repository secrets**, pulsa **New repository secret** y crea:

| Nombre | Valor |
|---|---|
| `WODBUSTER_EMAIL` | Correo de la primera cuenta |
| `WODBUSTER_PASSWORD` | Contraseña de la primera cuenta |
| `WODBUSTER_EMAIL_2` | Correo de la segunda cuenta |
| `WODBUSTER_PASSWORD_2` | Contraseña de la segunda cuenta |

4. Abre la pestaña **Actions** del repositorio y habilita los workflows si GitHub lo solicita.

## Primera prueba recomendada

1. Abre **Actions → Reserva WodBuster**.
2. Pulsa **Run workflow**.
3. Mantén activado **Modo prueba (`dry_run`)**.
4. Pulsa el botón verde **Run workflow**.
5. Abre la ejecución y revisa los dos trabajos: **Reservar (cuenta 1)** y **Reservar (cuenta 2)**. El modo prueba inicia sesión y localiza las clases, pero no reserva.

Si las clases de la semana siguiente todavía no están publicadas, la prueba se considera correcta siempre que haya podido iniciar sesión y abrir el calendario. La ejecución real del domingo sí falla si no encuentra una clase solicitada.

Una ejecución manual con `dry_run` desactivado intenta reservar inmediatamente; no espera al domingo.

## Ejecución automática

El workflow `.github/workflows/reservar.yml` usa la zona horaria `Europe/Madrid` y se ejecuta en tres momentos semanales:

- A las **14:35**, las dos cuentas inician sesión en paralelo y esperan hasta las **15:00** para intentar reservar el martes.
- El domingo a las **22:05**, las dos cuentas inician sesión en paralelo y esperan hasta las **22:30** para intentar reservar el jueves.
- El lunes a las **22:05**, las dos cuentas inician sesión en paralelo y esperan hasta las **22:30** para intentar reservar el viernes.

La separación evita buscar cada clase antes de que el centro la publique. Las ejecuciones reales siguen marcándose como error si no encuentran la clase correspondiente.

La lista de espera está desactivada (`JOIN_WAITLIST=false`). Si una clase está completa, la ejecución lo indicará pero no realizará esa inscripción.

## Seguridad y comportamiento

- El workflow solo tiene permiso de lectura sobre el repositorio.
- Los secretos se entregan exclusivamente al paso que abre WodBuster.
- Una prueba manual no hace clic en `Entrenar` ni en `Avisar`.
- Una reserva real solo se considera confirmada si el botón cambia al estado `Borrar`.
- Cuando varias actividades comparten hora, se puede usar `16:00|NombreExacto`. Si el nombre no coincide, el bot falla en vez de reservar otra actividad.
- No existe código para resolver o evitar CAPTCHA.

## Desarrollo

Requiere Node.js 22 o posterior.

```bash
npm install
npm run check
npm test
```

El cliente usa Puppeteer y selectores compatibles con la interfaz actual de WodBuster. Los cambios de interfaz de la plataforma pueden requerir actualizar esos selectores.

## Licencia y atribución

MIT. Parte del análisis de navegación y de los selectores de WodBuster se basa en [RubenGlez/autowod](https://github.com/RubenGlez/autowod), publicado bajo licencia MIT. Consulta `THIRD_PARTY_NOTICES.md`.
