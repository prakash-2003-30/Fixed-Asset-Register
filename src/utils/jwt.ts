import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import type { Role } from '@prisma/client';

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret as jwt.Secret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret as jwt.Secret) as JwtPayload;
}
