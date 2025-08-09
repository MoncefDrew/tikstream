# Use Node.js base image
FROM node:18

# Install Python, pip, ffmpeg, and latest streamlink
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
    && pip3 install --break-system-packages --upgrade pip \
    && pip3 install --break-system-packages --upgrade streamlink \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the bot
COPY . .

# Expose port if needed
EXPOSE 10000 

# Start the bot
CMD ["node", "bot.js"]

