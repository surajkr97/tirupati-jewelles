# Development image — pairs with the bind mount in the root docker-compose.yml
# so edits on the host show up without a rebuild.
#
# Debian slim rather than alpine: Next's SWC/Turbopack binaries are glibc-first,
# and the musl builds occasionally misbehave. The size saving isn't worth it here.
FROM node:22-slim

WORKDIR /app

# Copied and installed before the rest of the source so this layer is cached and
# only reruns when the manifests actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# -H 0.0.0.0 binds to all interfaces. The default binding is unreachable from
# outside the container, so the published port would connect to nothing.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
