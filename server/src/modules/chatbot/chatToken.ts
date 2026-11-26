import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';

const ISSUER = 'bookmystay-api';
const AUDIENCE = 'bookmystay-chat';
const TTL_SECONDS = 24 * 60 * 60;

export interface ChatClaims {
  typ: 'chat';
  cid: string;
  hid: string;
}

/** Anonymous web-chat session: unlocks exactly one conversation (its visible messages) for 24h. */
export function signChatToken(conversationId: string, hotelId: string): string {
  return jwt.sign({ typ: 'chat', cid: conversationId, hid: hotelId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyChatToken(token: string): ChatClaims {
  try {
    const d = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    if (typeof d !== 'object' || d.typ !== 'chat' || typeof d.cid !== 'string') throw new Error('bad claims');
    return d as unknown as ChatClaims;
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'This chat session has expired. Please start a new chat.');
  }
}

declare global {
  namespace Express {
    interface Request {
      chat?: ChatClaims;
    }
  }
}

export function optionalChat(req: Request, _res: Response, next: NextFunction): void {
  const token = req.header('x-chat-token');
  if (token) req.chat = verifyChatToken(token);
  next();
}

export function requireChat(req: Request, _res: Response, next: NextFunction): void {
  const token = req.header('x-chat-token');
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Chat session required');
  req.chat = verifyChatToken(token);
  next();
}
