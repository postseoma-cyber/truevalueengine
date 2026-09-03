#!/bin/sh
# Staging is deliberately belt-and-braces about not being indexed: robots.txt
# says Disallow (TVE_STAGING=1, read at request time) AND the proxy stamps
# X-Robots-Tag: noindex on every response. Either alone would do; a staging copy
# of a site whose whole pitch is trustworthy numbers is not worth the risk.
set -e
H=staging.truevalueengine.com
docker rm -f tve-web-staging >/dev/null 2>&1 || true
docker run -d --name tve-web-staging --restart unless-stopped \
  --network coolify \
  --env-file /opt/tve-web/.env.local \
  -e NODE_ENV=production \
  -p 127.0.0.1:3001:3000 \
  -l traefik.enable=true \
  -l traefik.docker.network=coolify \
  -l traefik.http.services.tve-staging.loadbalancer.server.port=3000 \
  -l 'traefik.http.middlewares.tve-staging-noindex.headers.customresponseheaders.X-Robots-Tag=noindex, nofollow' \
  -l traefik.http.middlewares.tve-staging-https.redirectscheme.scheme=https \
  -l traefik.http.routers.tve-staging-http.entryPoints=http \
  -l "traefik.http.routers.tve-staging-http.rule=Host(\`$H\`) && PathPrefix(\`/\`)" \
  -l traefik.http.routers.tve-staging-http.middlewares=tve-staging-noindex,tve-staging-https \
  -l traefik.http.routers.tve-staging.entryPoints=https \
  -l "traefik.http.routers.tve-staging.rule=Host(\`$H\`) && PathPrefix(\`/\`)" \
  -l traefik.http.routers.tve-staging.middlewares=tve-staging-noindex \
  -l traefik.http.routers.tve-staging.tls=true \
  -l traefik.http.routers.tve-staging.tls.certresolver=letsencrypt \
  -l traefik.http.routers.tve-staging.service=tve-staging \
  -l traefik.http.routers.tve-staging-http.service=tve-staging \
  tve-web:latest >/dev/null
sleep 6
docker ps --filter name=tve-web-staging --format 'container: {{.Status}}'
curl -s -o /dev/null -w 'local  : %{http_code}\n' http://127.0.0.1:3001/robots.txt
curl -s -o /dev/null -w 'via proxy (Host header): %{http_code}\n' -H "Host: $H" http://127.0.0.1/
curl -s -I -H "Host: $H" http://127.0.0.1/ | grep -i 'x-robots-tag\|location' || true
