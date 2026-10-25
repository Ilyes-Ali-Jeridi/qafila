/**
 * Plain messages for wallet and contract failures (PLAN 4.1 error handling).
 * Nothing technical reaches the user; the raw error is kept on the thrown WalletError.
 */
import { Errors as ContractErrors } from '@qafila/contract-client';

export class WalletError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly raw?: unknown,
  ) {
    super(message);
  }
}

const CONTRACT_MESSAGES: Record<string, string> = {
  NotAuthorized: 'This wallet is not allowed to do that.',
  Paused: 'The app is paused. Refunds and claims still work.',
  DealNotFound: 'This deal does not exist on-chain.',
  InvalidState: 'This deal is not in the right state for that.',
  InvalidAmount: 'That amount is not valid.',
  ExceedsRemaining: 'That is more than what is left.',
  NotApprovedInvestor: 'Finish sign-up first so your wallet is approved to invest.',
  NoPromise: 'The purchase promise has not been signed yet.',
  PromiseMismatch: 'The signed promise does not match this deal.',
  FundingClosed: 'Funding has closed for this deal.',
  AcceptWindowClosed: 'The window to sign the sale has closed.',
  DueNotPassed: 'The due date has not passed yet.',
  TooManyInvestors: 'This deal has reached its investor cap.',
  LimitExceeded: 'This deal is above the importer limit.',
  ImporterInDefault: 'This wallet has a default on record.',
  NothingToClaim: 'There is nothing to claim for this wallet.',
  SecurityTooLow: 'The security deposit is below what this deal needs.',
  SecurityTooHigh: 'The security deposit cannot be as high as the cost.',
  PromiseExists: 'A promise already exists for this deal. Withdraw it first.',
  PromiseListed: 'The deal is already listed, so the promise cannot change.',
  NothingToRefund: 'No refund is waiting for this wallet.',
  InvalidDueDate: 'That due date is not allowed.',
  AlreadyExtended: 'This deal was already extended once.',
  Overflow: 'The amount is too large.',
};

const KIT_MESSAGES: Record<number, string> = {
  4004: 'Your passkey prompt was closed. Try again.',
  4003: 'This browser does not support passkeys. Try Chrome, Safari or Edge.',
  4001: 'The passkey could not be created. Try again.',
  4002: 'The passkey could not be used. Try again.',
  2001: 'Connect your wallet first.',
  2003: 'No wallet was found for this passkey.',
  2007: 'Several wallets use this passkey. Pick one in settings.',
  3001: 'No passkey is stored on this device. Sign in to find your wallet.',
  5001: 'The network rejected this action before sending it.',
  5002: 'The transaction could not be signed.',
  5003: 'The network did not accept the transaction. Try again in a moment.',
  5004: 'The network is slow right now. Check the transaction link in a minute.',
  9001: 'Your session expired. Sign in again.',
};

/** Finds a Qafila contract error name in any error text, e.g. "Error(Contract, #7)". */
export function contractErrorName(text: string): string | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(text);
  if (m) {
    const entry = (ContractErrors as Record<number, { message: string }>)[Number(m[1])];
    if (entry) return entry.message;
  }
  for (const name of Object.keys(CONTRACT_MESSAGES)) if (new RegExp(`\\b${name}\\b`).test(text)) return name;
  return null;
}

export function toWalletError(e: unknown, fallback = 'Something went wrong. Try again.'): WalletError {
  if (e instanceof WalletError) return e;
  const obj = (e ?? {}) as { code?: unknown; message?: unknown; contractErrorName?: unknown; name?: unknown; cause?: unknown; context?: unknown };
  const msg = typeof obj.message === 'string' ? obj.message : '';
  if (typeof obj.contractErrorName === 'string' && obj.contractErrorName in CONTRACT_MESSAGES) {
    return new WalletError(CONTRACT_MESSAGES[obj.contractErrorName]!, obj.contractErrorName, e);
  }
  const fromText = contractErrorName(msg) ?? contractErrorName(JSON.stringify(obj.context ?? ''));
  if (fromText && CONTRACT_MESSAGES[fromText]) return new WalletError(CONTRACT_MESSAGES[fromText]!, fromText, e);
  if (typeof obj.code === 'number' && KIT_MESSAGES[obj.code]) return new WalletError(KIT_MESSAGES[obj.code]!, String(obj.code), e);
  if (obj.name === 'NotAllowedError' || /not allowed|cancel|abort/i.test(msg)) return new WalletError('Your passkey prompt was closed. Try again.', 'cancelled', e);
  if (/POOL_CAPACITY|FEE_LIMIT|UNAUTHORIZED|relayer/i.test(msg)) return new WalletError('The fee sponsor is busy. Try again in a few seconds.', 'relayer', e);
  if (/insufficient|balance|underfunded|trustline/i.test(msg)) return new WalletError('Your wallet does not hold enough test dollars for this.', 'balance', e);
  if (/User declined|rejected/i.test(msg)) return new WalletError('You declined the request in your wallet.', 'declined', e);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new WalletError('Could not reach the network. Check your connection and try again.', 'network', e);
  return new WalletError(msg && msg.length < 140 ? msg : fallback, 'unknown', e);
}
