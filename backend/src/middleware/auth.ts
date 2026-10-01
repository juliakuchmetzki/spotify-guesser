import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getUser } from '../database';

declare global {
  namespace Express {
    interface Request {
      userId: number;
    }
  }
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET fehlt (siehe .env.example)');
  return value;
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, secret(), { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  try {
    const payload = jwt.verify(token, secret()) as jwt.JwtPayload;
    const userId = Number(payload.sub);
    if (!getUser(userId)) return res.status(401).json({ error: 'User existiert nicht mehr' });
    req.userId = userId;
    next();
  } catch {
    res.status(401).json({ error: 'Sitzung abgelaufen – bitte neu anmelden' });
  }
}
