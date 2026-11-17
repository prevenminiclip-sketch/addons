/**
 * Movy / WeCollege custom stream cipher implementation.
 * Reversed from movy.sx client bundle (0m_507n6zv_8h.js).
 */

const MAGIC = [109, 118, 109, 49]; // "mvm1" magic header

function u(e: number): number {
  e >>>= 0;
  e ^= e >>> 16;
  e = Math.imul(e, 0x85ebca6b) >>> 0;
  e ^= e >>> 13;
  e = Math.imul(e, 0xc2b2ae35) >>> 0;
  return (e ^= e >>> 16) >>> 0;
}

function d(e: number, a: number): number {
  return (e >>>= 0, 0 === (a &= 31)) ? e >>> 0 : (e << a | e >>> 32 - a) >>> 0;
}

export function decryptMovyPayload(cipherStr: string, seedStr: string, mediaId: number | string): string {
  const b64 = cipherStr.replace(/-/g, '+').replace(/_/g, '/').padEnd(4 * Math.ceil(cipherStr.length / 4), '=');
  const s = new Uint8Array(Buffer.from(b64, 'base64'));
  const t = s.length;

  const midNum = Number(mediaId);
  const arr = new Array<number>(61);

  // FNV-1a inspired hash on seed string
  let fnv = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    fnv = Math.imul(fnv ^ seedStr.charCodeAt(i), 0x1000193) >>> 0;
  }
  fnv = u(fnv);

  let s_val = u(fnv ^ u(midNum >>> 0 ^ 0x9e3779b9)) >>> 0;
  for (let e = 0; e < 8; e++) {
    const idx = s_val % 61;
    s_val = d(s_val + 0x9e3779b9 >>> 0, 7 + (7 & e));
    arr[idx] = (s_val ^ u(s_val)) >>> 0;
    s_val = u(s_val + idx >>> 0);
  }

  const n_state = { S: arr, acc: u(0xa5a5a5a5 ^ s_val) >>> 0 };
  const keystream = new Uint8Array(t);
  let l = 0;

  for (let e = 0; e < t; ) {
    const S = n_state.S;
    let acc = n_state.acc;
    const r_idx = acc % 61;
    const i_mask = 0 - Number(r_idx in S);
    const o_val = S[r_idx] >>> 0;
    const c_val = Math.imul(0x9e3779b9, (l++) + 1) >>> 0;
    let b_val = (((acc) ^ ((o_val ^ c_val) >>> 0)) >>> 0 | (acc & (o_val ^ c_val) & i_mask) >>> 0) >>> 0;

    acc = u((b_val = (d(b_val + acc >>> 0, 31 & r_idx) ^ d(acc, 31 & Math.imul(r_idx, 7))) >>> 0) + 0x9e3779b9 >>> 0);
    S[r_idx] = acc >>> 0;
    n_state.acc = acc;

    keystream[e++] = 255 & acc;
    if (e < t) keystream[e++] = acc >>> 8 & 255;
    if (e < t) keystream[e++] = acc >>> 16 & 255;
    if (e < t) keystream[e++] = acc >>> 24 & 255;
  }

  for (let e = 0; e < t; e++) {
    s[e] ^= keystream[e];
  }

  for (let e = 0; e < MAGIC.length; e++) {
    if (s[e] !== MAGIC[e]) {
      throw new Error(`Decryption failed: bad seed or tampered payload (magic mismatch at index ${e})`);
    }
  }

  return Buffer.from(s.subarray(MAGIC.length)).toString('utf8');
}
