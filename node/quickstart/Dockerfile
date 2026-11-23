# Build context must be node/ (this quickstart depends on the sibling SDK
# package via "file:.." in quickstart/package.json -- npm symlinks a local
# file: dependency rather than copying it, so the image keeps the same
# on-disk layout as the repo instead of a multi-stage copy-only-node_modules
# build, which would leave that symlink dangling):
#   docker build -f quickstart/Dockerfile -t obs-instrumentation-node-quickstart .
FROM node:20-slim
WORKDIR /workspace
COPY package.json ./
COPY src ./src
# The SDK's own dependencies (@opentelemetry/*) must be installed here too:
# quickstart's "file:.." dependency symlinks this directory in rather than
# copying it, so Node's module resolution needs /workspace/node_modules to
# exist for requires inside src/ to resolve when walking up from
# /workspace/quickstart/node_modules.
RUN npm install --omit=dev --omit=peer

COPY quickstart ./quickstart
WORKDIR /workspace/quickstart
RUN npm install --omit=dev

ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
