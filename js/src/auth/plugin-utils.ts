import crypto from 'crypto';
import { Log } from '../util/log';
import { createVerboseFetch } from '../util/verbose-fetch';
export const log = Log.create({ service: 'auth-plugins' });
export const verboseFetch = createVerboseFetch(fetch, {
  caller: 'auth-plugins',
});

function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export async function generatePKCE() {
  const verifier = generateRandomString(32);
  const challenge = generateCodeChallenge(verifier);
  return { verifier, challenge };
}
