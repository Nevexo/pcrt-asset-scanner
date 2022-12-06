FROM mhart/alpine-node:16
WORKDIR /app

LABEL maintainer "Triarom Network Operations Centre <noc@triarom.co.uk>"

# Install dependencies
COPY package.json package-lock.json ./

RUN npm ci --only=production

# Switch to slim image
FROM mhart/alpine-node:slim-16

# Run up using tini
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# Reset workdir
WORKDIR /app

# Copy over the built app
COPY --from=0 /app .

# Copy in source code
COPY . .

# Expose default port
EXPOSE 3000

# Run the app
CMD ["node", "index.js"]