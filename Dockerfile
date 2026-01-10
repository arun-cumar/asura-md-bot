FROM node:lts-buster
RUN apt-get update && apt-get install ffmpeg imagemagick -y
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["node", "start.js"]
