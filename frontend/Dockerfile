# Fallback por si Dokploy no soporta despliegue estático directo para
# esta carpeta. Si sí lo soporta ("Static Site" / "Nginx" app type
# apuntando a frontend/ como raíz), este Dockerfile no hace falta.
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
