import test from 'node:test';
import { verifyConfirmedRounds } from './fixtures/pm-case-rounds.ts';

test('Case validates the exact Plan on each new choice and authorization and hands only the active authorization to Do', {timeout:90000}, t => verifyConfirmedRounds(t));
