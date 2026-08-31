# Manicura

Dos servicios independientes, cada uno con su propio despliegue en Dokploy:

- **`frontend/`** — sitio público (`index.html`) y panel admin (`admin/`),
  estáticos, sin build step. Dominio: `manicura.ankode.cloud`.
- **`backend/`** — API Node/Express + SQLite. No sirve HTML, solo `/api/*`.
  Dominio: `backen-general.ankode.cloud`.

Como son dos dominios/subdominios distintos, la comunicación entre ambos es
cross-origin: el frontend llama a la API vía `fetch` con
`credentials: 'include'`, y el backend responde con CORS restringido a los
orígenes permitidos.

## Variables de entorno

### `frontend/` — servicio estático

No necesita variables de entorno. La URL del backend está hardcodeada como
constante `API_BASE_URL` al inicio del script en `index.html`,
`admin/login.html` y `admin/assets/admin.js` — si el dominio de la API
cambia, hay que actualizarla en los tres archivos.

### `backend/` — servicio Docker/Node

Configurar en el panel de Dokploy (o en `.env` para correr local, ver
`.env.example`):

| Variable | Ejemplo | Notas |
|---|---|---|
| `PORT` | `3000` | Puerto interno del contenedor. |
| `NODE_ENV` | `production` | Activa `secure: true` en la cookie de sesión. |
| `DB_PATH` | `/app/data/manicura.db` | Debe apuntar dentro del volumen persistente. |
| `ADMIN_USER` | — | Usuario admin, se usa solo la primera vez que arranca (seed). |
| `ADMIN_PASSWORD` | — | Password admin, mismo caso — cambiarla después no reemplaza la cuenta ya creada. |
| `ALLOWED_ORIGINS` | `https://manicura.ankode.cloud` | Lista separada por comas de orígenes permitidos por CORS. Debe incluir el dominio exacto (con `https://`, sin slash final) del frontend. |
| `COOKIE_DOMAIN` | `.ankode.cloud` | Dominio de la cookie de sesión para que la vean ambos subdominios. Vacío = cookie host-only (sirve para probar en `localhost`). |
| `COOKIE_SAMESITE` | `lax` | `lax` alcanza si frontend y backend comparten dominio raíz (caso de arriba). Si terminan en dominios totalmente distintos, usar `none` (requiere HTTPS en ambos). |

## Despliegue en Dokploy

1. **`manicura-frontend`**: tipo "Static Site" apuntando a la carpeta
   `frontend/` del repo, dominio `manicura.ankode.cloud`. Si ese tipo de
   servicio no está disponible, usar el `Dockerfile` (nginx) incluido en
   `frontend/`.
2. **`manicura-backend`**: tipo Docker/Dockerfile apuntando a la carpeta
   `backend/`, desplegado en `backen-general.ankode.cloud`, con las
   variables de la tabla de arriba y un volumen persistente montado en
   `/app/data`.

Si después de desplegar aparece "Bad Gateway" en el backend, no es un
problema de la separación de carpetas — revisar los logs del servicio en
Dokploy; casi siempre es una variable de entorno faltante o el volumen de
`/app/data` mal montado.

## Desarrollo local

```bash
cd backend
npm install
npm run dev            # API en el puerto de PORT (.env)
```

```bash
cd frontend
npx serve -l 8080 .    # o cualquier servidor estático
```

Para probar local, en `frontend/index.html`, `frontend/admin/login.html` y
`frontend/admin/assets/admin.js` cambia temporalmente `API_BASE_URL` a
`http://localhost:3001` (o el puerto que uses), y en `backend/.env` pon
`ALLOWED_ORIGINS=http://localhost:8080`.
