import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { DB } from './db.js';
import { resolveStaff } from './auth.js';

/**
 * Each socket joins only its own restaurant room (and a personal room) after
 * the token is verified, so events can never cross restaurants.
 */
export class Realtime {
  io: Server | null = null;

  attach(http: HttpServer, db: DB, secret: string) {
    this.io = new Server(http, { path: '/socket.io', cors: { origin: false } });
    this.io.use((socket, next) => {
      const s = resolveStaff(db, secret, (socket.handshake.auth?.token as string) ?? null);
      if (!s) return next(new Error('unauthorized'));
      socket.data.staff = { userId: s.userId, rid: s.rid, role: s.role };
      next();
    });
    this.io.on('connection', (socket) => {
      const { rid, userId, role } = socket.data.staff;
      socket.join(`r:${rid}`);
      socket.join(`r:${rid}:u:${userId}`);
      socket.join(`r:${rid}:role:${role}`);
    });
  }

  /** Broadcast to everyone in one restaurant. */
  emit(rid: number, event: string, payload: unknown = {}) {
    this.io?.to(`r:${rid}`).emit(event, payload);
  }
  emitToUser(rid: number, userId: number, event: string, payload: unknown = {}) {
    this.io?.to(`r:${rid}:u:${userId}`).emit(event, payload);
  }
}

export interface Realtime {
  emitToRoles(rid: number, roles: string[], event: string, payload?: unknown): void;
}
Realtime.prototype.emitToRoles = function (rid: number, roles: string[], event: string, payload: unknown = {}) {
  if (!this.io || !roles.length) return;
  this.io.to(roles.map((r) => `r:${rid}:role:${r}`)).emit(event, payload);
};
