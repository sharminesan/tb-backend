const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

class BrowserWebcamService {
  constructor(io) {
    this.io = io;
    this.connectedClients = new Map();
    this.broadcasters = new Set();
    this.viewers = new Set();

    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`📱 Browser webcam client connected: ${socket.id}`);

      this.connectedClients.set(socket.id, {
        socket: socket,
        type: "viewer", // default to viewer
        connectedAt: Date.now(),
        frameCount: 0,
      });

      // Handle stream broadcasting (from transmitter)
      socket.on("stream", (imageData) => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          client.frameCount++;
          client.type = "broadcaster";
          this.broadcasters.add(socket.id);

          // Log occasionally
          if (client.frameCount % 100 === 0) {
            console.log(
              `📊 Broadcaster ${socket.id} sent ${client.frameCount} frames`
            );
          }
        }

        // Broadcast to all viewers except the sender
        socket.broadcast.emit("stream", imageData);
      });

      // Handle viewer registration
      socket.on("register_viewer", () => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          client.type = "viewer";
          this.viewers.add(socket.id);
          console.log(`👁️ Client ${socket.id} registered as viewer`);
        }

        socket.emit("viewer_registered", {
          message: "Registered as viewer",
          broadcasters: this.broadcasters.size,
          viewers: this.viewers.size,
        });
      });

      // Handle broadcaster registration
      socket.on("register_broadcaster", () => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          client.type = "broadcaster";
          this.broadcasters.add(socket.id);
          console.log(`📡 Client ${socket.id} registered as broadcaster`);
        }

        socket.emit("broadcaster_registered", {
          message: "Registered as broadcaster",
          viewers: this.viewers.size,
        });
      });

      // Handle service stats request
      socket.on("get_service_stats", () => {
        socket.emit("service_stats", {
          totalClients: this.connectedClients.size,
          broadcasters: this.broadcasters.size,
          viewers: this.viewers.size,
          uptime: process.uptime(),
        });
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          console.log(
            `🔌 ${client.type} disconnected: ${socket.id} (${client.frameCount} frames)`
          );

          this.broadcasters.delete(socket.id);
          this.viewers.delete(socket.id);
          this.connectedClients.delete(socket.id);

          // Notify remaining clients about the change
          this.io.emit("client_disconnected", {
            broadcasters: this.broadcasters.size,
            viewers: this.viewers.size,
          });
        }
      });
    });
  }

  getStats() {
    return {
      totalClients: this.connectedClients.size,
      broadcasters: this.broadcasters.size,
      viewers: this.viewers.size,
      uptime: process.uptime(),
    };
  }
}

module.exports = BrowserWebcamService;
