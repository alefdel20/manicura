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

Este repo es el "general" del portafolio de demos: **este mismo despliegue
de Dokploy hospeda todas las demos**, cada una como un subpath, para no
tener que dar de alta un servicio nuevo por cada demo.

## Demos montadas en este repo

| Demo | Frontend | Backend |
|---|---|---|
| Manicura (esta) | `manicura.ankode.cloud/` | `backen-general.ankode.cloud/api/*` |
| [Dentista](#demo-dentista) | `manicura.ankode.cloud/dentista/` | `backen-general.ankode.cloud/api/dentista/*` |

### Demo: dentista

Vive en `frontend/dentista/` (estáticos) y `backend/server/dentista/`
(rutas Express montadas en `/api/dentista` y `/api/dentista/admin` dentro
del `server/index.js` de este mismo backend). Usa su **propia base de
datos SQLite** (`dentista.db`, junto a `manicura.db` en el mismo volumen
`/app/data`) y su **propia cookie de sesión** (`sid_dentista`, con
`Path=/api/dentista` para no pisarse con la cookie `sid` de manicura) —
así que ambos paneles admin pueden tener sesión abierta al mismo tiempo sin
conflicto. Ver `backend/.env.example` para las variables `DENTISTA_*`
específicas de esa demo, y el `README.md` original dentro de la carpeta
`dentista/` suelta (ver nota abajo) para el diseño completo de esa demo
(roles clínica/dentista, catálogo de tratamientos, etc).

> Nota: existe una carpeta `dentista/` fuera de este repo (hermana de
> `manicura/`) con el proyecto original standalone, pensado en su momento
> para desplegarse como servicio propio en Dokploy. Se dejó **sin borrar
> como respaldo/referencia**, pero ya no se despliega por separado — la
> versión que corre en producción es la que vive dentro de este repo, bajo
> `frontend/dentista/` y `backend/server/dentista/`. Si se edita algo de la
> demo dentista, hay que editarlo aquí, no en esa carpeta suelta.

Para agregar una demo nueva más adelante, sigue el mismo patrón: sus
archivos estáticos en `frontend/<demo>/`, sus rutas Express en
`backend/server/<demo>/` montadas bajo `/api/<demo>` en `server/index.js`,
su propia base de datos SQLite dentro de `/app/data`, y su propia cookie de
sesión (nombre y `Path` distintos) si tiene panel admin.

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

Para probar la demo dentista en local, haz lo mismo en sus tres archivos
(`frontend/dentista/index.html`, `frontend/dentista/admin/login.html`,
`frontend/dentista/admin/assets/admin.js`), cambiando `API_BASE_URL` a
`http://localhost:3001/api/dentista`, y agrega en `backend/.env` las
variables `DENTISTA_ADMIN_USER`/`DENTISTA_ADMIN_PASSWORD` (ver
`.env.example`) para que se cree la cuenta de clínica al arrancar.
