import { WsAuthenticator } from '@nestjs/authentication';
import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AdminAuthService } from '../admin/admin-auth.service.js';
import type { UserRow } from '../db/schema.js';
import { EventBus, type LiveEvent } from './event-bus.js';

const origins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * The live channel. A client connects with its token and is put in a room of
 * its own; it sends nothing and subscribes to nothing, so it can only ever
 * receive events addressed to it. Each event is a nudge to fetch fresh data.
 */
@WebSocketGateway({ cors: { origin: origins.length > 0 ? origins : false } })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('Live');

  @WebSocketServer()
  private readonly server?: Server;

  constructor(
    private readonly wsAuthenticator: WsAuthenticator,
    private readonly adminAuth: AdminAuthService,
    private readonly bus: EventBus,
  ) {}

  afterInit() {
    this.bus.subscribe((event) => this.deliver(event));
  }

  async handleConnection(client: Socket) {
    try {
      const { token, adminToken } = client.handshake.auth as { token?: unknown; adminToken?: unknown };
      if (typeof adminToken === 'string') {
        if (await this.adminAuth.findBySession(adminToken)) {
          await client.join('admins');
          return;
        }
      } else if (typeof token === 'string') {
        // Browsers cannot set headers on a WebSocket, so the token arrives in the handshake's auth field.
        client.handshake.headers.authorization = `Bearer ${token}`;
        await this.wsAuthenticator.authenticateConnection(client);
        const user = (client as Socket & { user?: UserRow }).user;
        if (user) {
          await client.join(`user:${user.id}`);
          return;
        }
      }
    } catch (error) {
      this.logger.debug(`Refused a connection: ${String(error)}`);
    }
    client.disconnect(true);
  }

  private deliver({ userIds, admins, name, data }: LiveEvent) {
    const rooms = [...userIds.map((id) => `user:${id}`), ...(admins ? ['admins'] : [])];
    if (this.server && rooms.length > 0) {
      this.server.to(rooms).emit(name, data);
    }
  }
}
