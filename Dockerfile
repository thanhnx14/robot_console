# Use the official Node.js 22-alpine image from Docker Hub
FROM node:22-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port the app runs on
EXPOSE 8081

# Start the Next.js application on port 8081
CMD ["npm", "start", "--", "-p", "8081"]
