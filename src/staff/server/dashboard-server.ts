import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { AuthManager, AuthenticationError, ForbiddenError } from '../auth/access-control.js';
import { TakeoverCoordinator, DuplicateMessageError, InvalidStateTransitionError } from '../takeover/takeover-coordinator.js';
import { getDashboardHtml } from './dashboard-html.js';
import { PropertyId, StaffUser } from '../staff-types.js';
import { FreeLLMGateway } from '../../conversation/adapters/free-llm-gateway.js';

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  store: SqliteStore;
  authManager: AuthManager;
  takeoverCoordinator: TakeoverCoordinator;
  llmGateway?: FreeLLMGateway;
}

export class DashboardServer {
  private server: Server;
  private port: number;
  private host: string;
  private store: SqliteStore;
  private authManager: AuthManager;
  private takeoverCoordinator: TakeoverCoordinator;
  private llmGateway?: FreeLLMGateway;

  constructor(options: DashboardServerOptions) {
    this.port = options.port ?? parseInt(process.env.DASHBOARD_PORT ?? '3000', 10);
    this.host = options.host ?? '127.0.0.1';
    this.store = options.store;
    this.authManager = options.authManager;
    this.takeoverCoordinator = options.takeoverCoordinator;
    this.llmGateway = options.llmGateway;

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  public async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        const address = `http://127.0.0.1:${actualPort}`;
        resolve(address);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  public getHttpServer(): Server {
    return this.server;
  }

  // --------------------------------------------------------------------------
  // Request Dispatcher
  // --------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Set default security & CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // 1. Static HTML Dashboard View
      if (pathname === '/' || pathname === '/index.html' || pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
        return;
      }

      // 2. Health check
      if (pathname === '/api/health') {
        this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
        return;
      }

      // 3. Auth Endpoints (No auth token required)
      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const session = this.authManager.login(body.username, body.password);
        this.sendJson(res, 200, session);
        return;
      }

      // All following endpoints require authenticated staff token
      const token = this.extractBearerToken(req);
      const user = this.authManager.validateToken(token);

      if (pathname === '/api/auth/logout' && method === 'POST') {
        if (token) this.authManager.logout(token);
        this.sendJson(res, 200, { success: true });
        return;
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        this.sendJson(res, 200, { user });
        return;
      }

      // 4. Properties Allowed for User
      if (pathname === '/api/properties' && method === 'GET') {
        if (user.role === 'admin') {
          this.sendJson(res, 200, {
            properties: ['j-village', 'jacayl-tran-khat-chan', 'jacayl-ha-dong'],
            isAdmin: true,
          });
        } else {
          this.sendJson(res, 200, {
            properties: user.propertyId ? [user.propertyId] : [],
            isAdmin: false,
          });
        }
        return;
      }

      // 5. Telemetry (Visible only to staff, secrets completely redacted)
      if (pathname === '/api/telemetry' && method === 'GET') {
        const engine = process.env.CONVERSATION_ENGINE || 'agentic';
        const status = this.llmGateway ? this.llmGateway.getProviderStatus() : {
          activeMode: 'auto',
          freeOnlyMode: true,
          groq: { name: 'Groq', configured: true, model: 'openai/gpt-oss-20b', isRateLimited: false, rateLimitCooloffSecRemaining: 0 },
          gemini: { name: 'Gemini', configured: true, model: 'gemini-3.5-flash-lite', isRateLimited: false, rateLimitCooloffSecRemaining: 0 },
          mock: { name: 'Mock', configured: true, model: 'internal-rulebase', isRateLimited: false, rateLimitCooloffSecRemaining: 0 }
        };
        this.sendJson(res, 200, {
          ...status,
          engine,
          buildVersion: '2.2.0-agentic-cognitive',
        });
        return;
      }

      // 6. Conversations List with Multi-Property Isolation
      if (pathname === '/api/conversations' && method === 'GET') {
        const queryProp = url.searchParams.get('propertyId') as PropertyId | null;
        const queryState = url.searchParams.get('state') as any;
        const search = url.searchParams.get('search') ?? undefined;

        // MULTI-PROPERTY ISOLATION:
        // If staff user: ALWAYS force their assigned propertyId (never trust query param to access other property)
        let effectivePropertyId: PropertyId | undefined;
        if (user.role === 'staff') {
          if (!user.propertyId) throw new ForbiddenError('Tài khoản nhân viên chưa được gán cơ sở.');
          if (queryProp && queryProp !== user.propertyId) {
            throw new ForbiddenError(`Bạn không có quyền xem cuộc trò chuyện của cơ sở '${queryProp}'.`);
          }
          effectivePropertyId = user.propertyId;
        } else {
          // Admin can filter by any property or leave undefined to view all
          effectivePropertyId = queryProp ?? undefined;
        }

        const result = this.store.listConversations({
          propertyId: effectivePropertyId,
          state: queryState ?? 'ALL',
          search,
          limit: 100,
        });

        this.sendJson(res, 200, result);
        return;
      }

      // 7. Conversation Detail: GET /api/conversations/:id
      const convDetailMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (convDetailMatch && method === 'GET') {
        const conversationId = convDetailMatch[1];
        const conv = this.store.getConversationById(conversationId);
        if (!conv) {
          this.sendJson(res, 404, { error: `Cuộc trò chuyện '${conversationId}' không tồn tại.` });
          return;
        }

        // Multi-Property isolation enforcement
        AuthManager.enforcePropertyAccess(user, conv.propertyId);

        // Reset staff unread count on view
        this.store.resetStaffUnread(conversationId);

        const messages = this.store.getMessagesByConversationId(conversationId, 200);
        const internalNotes = this.store.getInternalNotesByConversationId(conversationId);

        this.sendJson(res, 200, {
          conversation: conv,
          messages,
          internalNotes,
        });
        return;
      }

      // 8. Human Takeover: POST /api/conversations/:id/takeover
      const takeoverMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/takeover$/);
      if (takeoverMatch && method === 'POST') {
        const conversationId = takeoverMatch[1];
        const updated = this.takeoverCoordinator.takeoverConversation(conversationId, user);
        this.sendJson(res, 200, { conversation: updated });
        return;
      }

      // 9. Resume AI: POST /api/conversations/:id/resume-ai
      const resumeMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/resume-ai$/);
      if (resumeMatch && method === 'POST') {
        const conversationId = resumeMatch[1];
        const updated = this.takeoverCoordinator.resumeAI(conversationId, user);
        this.sendJson(res, 200, { conversation: updated });
        return;
      }

      // 10. Close Conversation: POST /api/conversations/:id/close
      const closeMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/close$/);
      if (closeMatch && method === 'POST') {
        const conversationId = closeMatch[1];
        const updated = this.takeoverCoordinator.closeConversation(conversationId, user);
        this.sendJson(res, 200, { conversation: updated });
        return;
      }

      // 11. Reopen Conversation: POST /api/conversations/:id/reopen
      const reopenMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/reopen$/);
      if (reopenMatch && method === 'POST') {
        const conversationId = reopenMatch[1];
        const updated = this.takeoverCoordinator.reopenConversation(conversationId, user);
        this.sendJson(res, 200, { conversation: updated });
        return;
      }

      // 12. Staff Send Message: POST /api/conversations/:id/messages
      const staffMsgMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (staffMsgMatch && method === 'POST') {
        const conversationId = staffMsgMatch[1];
        const body = await this.readJsonBody(req);
        const message = this.takeoverCoordinator.sendStaffMessage(
          conversationId,
          user,
          body.content,
          body.clientMessageId
        );
        this.sendJson(res, 201, { message });
        return;
      }

      // 13. Add Internal Note: POST /api/conversations/:id/notes
      const noteMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/notes$/);
      if (noteMatch && method === 'POST') {
        const conversationId = noteMatch[1];
        const body = await this.readJsonBody(req);
        const note = this.takeoverCoordinator.addInternalNote(conversationId, user, body.content);
        this.sendJson(res, 201, { note });
        return;
      }

      // 14. Simulated Customer Turn: POST /api/simulate/customer-turn
      if (pathname === '/api/simulate/customer-turn' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const result = await this.takeoverCoordinator.handleCustomerTurn(
          body.conversationId,
          body.propertyId,
          body.content,
          {
            clientMessageId: body.clientMessageId,
            referenceClock: body.referenceClock,
            customerName: body.customerName,
            customerPhone: body.customerPhone,
          }
        );
        this.sendJson(res, 200, result);
        return;
      }

      // 15. Audit Logs: GET /api/audit-logs
      if (pathname === '/api/audit-logs' && method === 'GET') {
        const queryConvId = url.searchParams.get('conversationId') ?? undefined;
        let queryProp = url.searchParams.get('propertyId') as PropertyId | undefined;

        if (user.role === 'staff') {
          queryProp = user.propertyId ?? undefined;
        }

        const logs = this.store.getAuditLogs({
          conversationId: queryConvId,
          propertyId: queryProp,
          limit: 100,
        });
        this.sendJson(res, 200, { items: logs });
        return;
      }

      // Route Not Found
      this.sendJson(res, 404, { error: `Endpoint '${method} ${pathname}' không tìm thấy.` });
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        this.sendJson(res, 401, { error: err.message });
        return;
      }
      if (err instanceof ForbiddenError) {
        this.sendJson(res, 403, { error: err.message });
        return;
      }
      if (err instanceof DuplicateMessageError || err instanceof InvalidStateTransitionError) {
        this.sendJson(res, 409, { error: err.message });
        return;
      }
      console.error('[DashboardServer Error]:', err);
      this.sendJson(res, 500, { error: err.message || 'Lỗi xử lý máy chủ nội bộ.' });
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private extractBearerToken(req: IncomingMessage): string | null {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
    return null;
  }

  private async readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 1024 * 1024) {
          // 1MB limit
          reject(new Error('Payload quá lớn (Vượt quá 1MB).'));
        }
      });
      req.on('end', () => {
        if (!data.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Định dạng JSON trong body không hợp lệ.'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, data: any): void {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }
}
