import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { PropertyId, StaffUser, StaffUserWithCredentials, StaffAuthSession } from '../staff-types.js';
import { SqliteStore } from '../persistence/sqlite-store.js';

export class StaffAuthError extends Error {
  constructor(message: string = 'Tài khoản hoặc mật khẩu không chính xác') {
    super(message);
    this.name = 'StaffAuthError';
  }
}

export const AuthenticationError = StaffAuthError;
export type AuthenticationError = StaffAuthError;

export class ForbiddenError extends Error {
  constructor(message: string = 'Bạn không có quyền thực hiện thao tác này') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface AuthManagerOptions {
  sessionTtlSeconds?: number;
  sessionSecret?: string;
}

export class AuthManager {
  private store: SqliteStore;
  private sessionTtlSeconds: number;
  private sessionSecret: string;
  private activeSessions: Map<string, { user: StaffUser; expiresAt: number }> = new Map();

  constructor(store: SqliteStore, options?: AuthManagerOptions) {
    this.store = store;
    this.sessionTtlSeconds = options?.sessionTtlSeconds ?? 86400; // 24 hours
    this.sessionSecret = options?.sessionSecret ?? process.env.STAFF_SESSION_SECRET ?? 'j-collection-secret-staff-key-2026';
  }

  // --------------------------------------------------------------------------
  // Password Hashing & Verification
  // --------------------------------------------------------------------------

  public static hashPassword(password: string): { hash: string; salt: string } {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
  }

  public static verifyPassword(password: string, hash: string, salt: string): boolean {
    try {
      const calculatedHash = scryptSync(password, salt, 64).toString('hex');
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculatedHash, 'hex'));
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Authentication & Session
  // --------------------------------------------------------------------------

  public login(username: string, password: string): StaffAuthSession {
    const userWithCreds = this.store.findUserByUsername(username);
    if (!userWithCreds) {
      throw new AuthenticationError('Tên đăng nhập hoặc mật khẩu không hợp lệ.');
    }

    const isValid = AuthManager.verifyPassword(password, userWithCreds.passwordHash, userWithCreds.salt);
    if (!isValid) {
      throw new AuthenticationError('Tên đăng nhập hoặc mật khẩu không hợp lệ.');
    }

    const user: StaffUser = {
      id: userWithCreds.id,
      username: userWithCreds.username,
      fullName: userWithCreds.fullName,
      role: userWithCreds.role,
      propertyId: userWithCreds.propertyId,
      isActive: userWithCreds.isActive,
      createdAt: userWithCreds.createdAt,
    };

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.sessionTtlSeconds;
    const token = this.generateToken(user.id, expiresAt);

    this.activeSessions.set(token, { user, expiresAt });

    // Audit log
    this.store.addAuditLog({
      propertyId: user.propertyId ?? undefined,
      staffId: user.id,
      staffName: user.fullName,
      action: 'LOGIN',
      details: { username: user.username, role: user.role },
    });

    return { token, user, expiresAt };
  }

  public logout(token: string): void {
    const session = this.activeSessions.get(token);
    if (session) {
      this.store.addAuditLog({
        propertyId: session.user.propertyId ?? undefined,
        staffId: session.user.id,
        staffName: session.user.fullName,
        action: 'LOGOUT',
        details: { username: session.user.username },
      });
      this.activeSessions.delete(token);
    }
  }

  public validateToken(token?: string | null): StaffUser {
    if (!token) {
      throw new AuthenticationError('Vui lòng đăng nhập để truy cập.');
    }

    const session = this.activeSessions.get(token);
    const now = Math.floor(Date.now() / 1000);

    if (session) {
      if (session.expiresAt < now) {
        this.activeSessions.delete(token);
        throw new AuthenticationError('Phiên đăng nhập đã hết hạn.');
      }
      return session.user;
    }

    // Verify token cryptographic signature if server restarted
    const verified = this.verifyTokenSignature(token);
    if (!verified || verified.expiresAt < now) {
      throw new AuthenticationError('Token không hợp lệ hoặc đã hết hạn.');
    }

    const dbUser = this.store.getUserById(verified.userId);
    if (!dbUser || !dbUser.isActive) {
      throw new AuthenticationError('Tài khoản không tồn tại hoặc đã bị vô hiệu hóa.');
    }

    this.activeSessions.set(token, { user: dbUser, expiresAt: verified.expiresAt });
    return dbUser;
  }

  // --------------------------------------------------------------------------
  // Multi-Property Authorization Guards
  // --------------------------------------------------------------------------

  public static canAccessProperty(user: StaffUser, propertyId: PropertyId): boolean {
    if (user.role === 'admin') {
      return true; // Admin has cross-property access
    }
    return user.propertyId === propertyId; // Staff is strictly scoped to assigned property
  }

  public static enforcePropertyAccess(user: StaffUser, propertyId: PropertyId): void {
    if (!AuthManager.canAccessProperty(user, propertyId)) {
      throw new ForbiddenError(
        `Từ chối truy cập: Tài khoản nhân viên '${user.username}' không có quyền truy cập dữ liệu của cơ sở '${propertyId}'.`
      );
    }
  }

  public static enforceAdmin(user: StaffUser): void {
    if (user.role !== 'admin') {
      throw new ForbiddenError('Thao tác yêu cầu quyền Quản trị viên (Admin).');
    }
  }

  // --------------------------------------------------------------------------
  // Token Generation & Signature
  // --------------------------------------------------------------------------

  private generateToken(userId: string, expiresAt: number): string {
    const payload = `${userId}:${expiresAt}:${randomBytes(12).toString('hex')}`;
    const hmac = createHmac('sha256', this.sessionSecret).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64url')}.${hmac}`;
  }

  private verifyTokenSignature(token: string): { userId: string; expiresAt: number } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [b64Payload, signature] = parts;
      const payload = Buffer.from(b64Payload, 'base64url').toString('utf8');
      const expectedHmac = createHmac('sha256', this.sessionSecret).update(payload).digest('hex');

      if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
        return null;
      }

      const [userId, expStr] = payload.split(':');
      const expiresAt = parseInt(expStr, 10);
      return { userId, expiresAt };
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Seed Default Users
  // --------------------------------------------------------------------------

  public static seedDefaultUsers(store: SqliteStore): void {
    const defaultUsers = [
      {
        id: 'user_admin_001',
        username: 'admin',
        fullName: 'Quản trị viên Tổng (Admin All Properties)',
        role: 'admin' as const,
        propertyId: null,
        password: 'Admin@JCollection2026!',
      },
      {
        id: 'user_staff_village_001',
        username: 'staff_village',
        fullName: 'Lễ tân J Village',
        role: 'staff' as const,
        propertyId: 'j-village' as const,
        password: 'Staff@Village2026!',
      },
      {
        id: 'user_staff_tkc_001',
        username: 'staff_tkc',
        fullName: 'Lễ tân Trần Khát Chân',
        role: 'staff' as const,
        propertyId: 'jacayl-tran-khat-chan' as const,
        password: 'Staff@TKC2026!',
      },
      {
        id: 'user_staff_hadong_001',
        username: 'staff_hadong',
        fullName: 'Lễ tân Jacayl Hà Đông',
        role: 'staff' as const,
        propertyId: 'jacayl-ha-dong' as const,
        password: 'Staff@HaDong2026!',
      },
    ];

    const now = new Date().toISOString();
    for (const u of defaultUsers) {
      if (!store.findUserByUsername(u.username)) {
        const { hash, salt } = AuthManager.hashPassword(u.password);
        store.createUser({
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          propertyId: u.propertyId,
          passwordHash: hash,
          salt,
          isActive: true,
          createdAt: now,
        });
      }
    }
  }
}
