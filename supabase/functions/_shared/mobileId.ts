// Nedap Mobile ID key diversification.
// Developer guide algorithm:
//   D = 0x01 || UIDA || CMAC padding to exactly 32 bytes
//   KEYA = AES-128-CMAC(MKEY, D, Padded)
// where the final block is XORed with K2 when padding was used, or K1 when it was not.

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, '').toUpperCase()
  if (clean.length % 2 !== 0 || !/^[0-9A-F]*$/.test(clean)) throw new Error('Invalid hexadecimal value')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error('XOR length mismatch')
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

function leftShiftOne(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(block.length)
  let carry = 0
  for (let i = block.length - 1; i >= 0; i--) {
    const value = block[i]
    out[i] = ((value << 1) & 0xff) | carry
    carry = (value & 0x80) !== 0 ? 1 : 0
  }
  return out
}

function deriveSubkey(input: Uint8Array): Uint8Array {
  const msbSet = (input[0] & 0x80) !== 0
  const out = leftShiftOne(input)
  if (msbSet) out[out.length - 1] ^= 0x87
  return out
}

async function aes128BlockEncrypt(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  if (key.length !== 16 || block.length !== 16) throw new Error('AES-128 requires 16-byte key and block')
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt'])
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, cryptoKey, block),
  )
  // WebCrypto AES-CBC applies PKCS#7 padding. The first block is still exactly AES(key, block),
  // so taking only the first 16 bytes gives us the raw block primitive needed for CMAC.
  return encrypted.slice(0, 16)
}

export async function deriveKeyA(mkey: Uint8Array, uida: Uint8Array): Promise<Uint8Array> {
  if (mkey.length !== 16) throw new Error('MKEY must be 16 bytes')
  if (uida.length < 1 || uida.length > 31) throw new Error('UIDA must be 1 to 31 bytes')

  const base = new Uint8Array(1 + uida.length)
  base[0] = 0x01
  base.set(uida, 1)

  const paddingLength = 32 - base.length
  if (paddingLength < 0) throw new Error('Diversification input is too long')
  const padded = paddingLength > 0

  const d = new Uint8Array(32)
  d.set(base)
  if (padded) d[base.length] = 0x80

  const zero = new Uint8Array(16)
  const k0 = await aes128BlockEncrypt(mkey, zero)
  const k1 = deriveSubkey(k0)
  const k2 = deriveSubkey(k1)

  const block1 = d.slice(0, 16)
  const block2 = d.slice(16, 32)
  const finalBlock = xor(block2, padded ? k2 : k1)

  const c1 = await aes128BlockEncrypt(mkey, block1)
  const c2 = await aes128BlockEncrypt(mkey, xor(finalBlock, c1))
  return c2
}

export async function deriveKeyAHex(mkeyHex: string, uidaHex: string): Promise<string> {
  return bytesToHex(await deriveKeyA(hexToBytes(mkeyHex), hexToBytes(uidaHex)))
}
